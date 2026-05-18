"""Single-pass signal extraction from a video.

Two raw signals are produced per frame:

* global scene motion (dx, dy) in working-resolution pixels, recovered with
  FFT phase correlation. Phase correlation finds the dominant global
  translation between consecutive frames and copes with the large, fast
  displacement of a flick far better than gradient-based optical flow. It is
  robust to small moving objects (enemies) because the background dominates
  the correlation peak.
* mean brightness inside the muzzle-flash ROI, used downstream to detect when
  the player is firing.

Limitation: a view movement faster than roughly half the frame width per
frame cannot be measured from video at all - it simply registers as a low
correlation response. Such frames are reported as low-confidence rather than
trusted.
"""

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class RawSignals:
    dx: np.ndarray            # scene motion x, working px per sampled frame
    dy: np.ndarray            # scene motion y, working px per sampled frame
    confidence: np.ndarray    # phase-correlation response, 0..1
    fire_brightness: np.ndarray  # mean brightness of the muzzle-flash ROI
    eff_fps: float
    n_frames: int
    work_width: int
    work_height: int


class _MotionEstimator:
    """Global translation via phase correlation on the non-HUD band."""

    def __init__(self, h, w, cfg):
        self.y0 = int(h * cfg.hud_top_frac)
        self.y1 = int(h * (1.0 - cfg.hud_bottom_frac))
        self.cw = w
        self.ch = self.y1 - self.y0
        self.hann = cv2.createHanningWindow((self.cw, self.ch), cv2.CV_32F)

    def prepare(self, gray):
        return gray[self.y0 : self.y1, :].astype(np.float32)

    def motion(self, prev_f, cur_f):
        (sx, sy), response = cv2.phaseCorrelate(prev_f, cur_f, self.hann)
        # phaseCorrelate returns the shift of prev relative to cur; negate so
        # (dx, dy) is the motion of scene content from prev to cur.
        return -sx, -sy, float(response)


def _roi_pixels(fire_roi, h, w):
    x0, y0, x1, y1 = fire_roi
    return int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)


def extract_signals(reader, cfg, progress=None):
    """Run the extraction pass over a VideoReader."""
    h, w = reader.work_height, reader.work_width
    estimator = _MotionEstimator(h, w, cfg)
    rx0, ry0, rx1, ry1 = _roi_pixels(cfg.fire_roi, h, w)
    total = reader.expected_frames

    dx, dy, conf, fire = [], [], [], []
    prev_f = None

    for idx, frame in reader.frames():
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        roi = gray[ry0:ry1, rx0:rx1]
        fire.append(float(roi.mean()) if roi.size else 0.0)

        cur_f = estimator.prepare(gray)
        if prev_f is None:
            dx.append(0.0)
            dy.append(0.0)
            conf.append(1.0)
        else:
            mx, my, response = estimator.motion(prev_f, cur_f)
            dx.append(mx)
            dy.append(my)
            conf.append(response)

        prev_f = cur_f
        if progress is not None:
            progress(idx + 1, total)

    return RawSignals(
        dx=np.asarray(dx, dtype=float),
        dy=np.asarray(dy, dtype=float),
        confidence=np.asarray(conf, dtype=float),
        fire_brightness=np.asarray(fire, dtype=float),
        eff_fps=reader.eff_fps,
        n_frames=len(dx),
        work_width=w,
        work_height=h,
    )
