"""Synthetic gameplay-clip generator.

Produces short, fully synthetic clips so the analyzer can be demonstrated and
regression-tested without any real footage. Two profiles are supported:

* "clean" - human-like play: slow target acquisition, jittery recoil.
* "macro" - scripted play: instant aim snaps, smooth/periodic recoil.

These clips contain no real game assets; they are abstract moving textures.
They exist purely to exercise the signal-processing pipeline.
"""

from pathlib import Path

import cv2
import numpy as np


def _make_background(rng, hb, wb):
    bg = rng.integers(45, 205, size=(hb, wb, 3), dtype=np.uint8)
    bg = cv2.GaussianBlur(bg, (0, 0), 2.5)
    for _ in range(70):
        p1 = (int(rng.integers(0, wb)), int(rng.integers(0, hb)))
        p2 = (int(rng.integers(0, wb)), int(rng.integers(0, hb)))
        col = tuple(int(c) for c in rng.integers(30, 230, 3))
        cv2.line(bg, p1, p2, col, int(rng.integers(1, 4)))
    for _ in range(45):
        c = (int(rng.integers(0, wb)), int(rng.integers(0, hb)))
        col = tuple(int(x) for x in rng.integers(20, 235, 3))
        cv2.circle(bg, c, int(rng.integers(10, 46)), col, -1)
    return bg


def _smooth_noise(rng, n, amp, scale):
    raw = rng.normal(0.0, 1.0, n)
    ker = np.ones(max(1, int(scale)))
    ker = ker / ker.sum()
    sm = np.convolve(raw, ker, mode="same")
    sm = np.convolve(sm, ker, mode="same")
    sm = sm / (np.std(sm) + 1e-9) * amp
    return sm


def _open_writer(path, fps, width, height):
    path = Path(path)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"),
                         fps, (width, height))
    if vw.isOpened():
        return vw, path
    path = path.with_suffix(".avi")
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"),
                         fps, (width, height))
    if not vw.isOpened():
        raise RuntimeError("Could not open a VideoWriter (no mp4v/MJPG codec)")
    return vw, path


def generate_clip(path, profile="macro", seconds=12, fps=30,
                  width=1280, height=720, fov_h=90.0, seed=0):
    """Render a synthetic clip and return the path actually written."""
    if profile not in ("clean", "macro"):
        raise ValueError("profile must be 'clean' or 'macro'")

    rng = np.random.default_rng(seed)
    n = int(seconds * fps)
    ppd = width / fov_h
    hb, wb = 1024, 2048
    bg = _make_background(rng, hb, wb)

    # Base view wander (both profiles look around the same way).
    yaw = _smooth_noise(rng, n, amp=5.0, scale=fps // 2)
    pitch = _smooth_noise(rng, n, amp=3.0, scale=fps // 2)
    firing = np.zeros(n, dtype=bool)

    macro = profile == "macro"
    centers = np.linspace(0.09, 0.93, 7)
    for ci in centers:
        engage = int(ci * n) + int(rng.integers(-fps // 6, fps // 6))
        if macro:
            flick_dur = 4
            flick_mag = float(rng.uniform(56, 72)) * rng.choice([-1.0, 1.0])
            reaction = int(rng.integers(0, 2))
        else:
            flick_dur = int(rng.integers(5, 8))
            flick_mag = float(rng.uniform(20, 38)) * rng.choice([-1.0, 1.0])
            reaction = int(rng.integers(7, 12))
        burst_len = int(rng.integers(int(0.30 * fps), int(0.55 * fps)))

        flick_start = max(1, engage - flick_dur - reaction)
        fire_start = flick_start + flick_dur + reaction
        fire_end = min(n, fire_start + burst_len)
        if fire_start >= n:
            continue

        # Flick: a step change in yaw spread over flick_dur frames.
        for k in range(flick_dur):
            fi = flick_start + k
            if fi < n:
                yaw[fi:] += flick_mag / flick_dur

        # Recoil added to the pitch channel over the firing region.
        recoil = np.zeros(fire_end - fire_start)
        r = 0.0
        for k in range(len(recoil)):
            if macro:
                # smooth, periodic, near-zero-net macro compensation
                recoil[k] = 1.4 * np.sin(2 * np.pi * k / 14.0) + rng.normal(0.0, 0.03)
            else:
                # jittery, mean-reverting human compensation
                r += rng.normal(0.0, 0.55) - 0.22 * r
                recoil[k] = r
        pitch[fire_start:fire_end] += recoil
        firing[fire_start:fire_end] = True

    vw, written = _open_writer(path, fps, width, height)
    rows0 = np.arange(height)
    cols0 = np.arange(width)
    flash_c = (int(0.50 * width), int(0.60 * height))

    target_x = rng.uniform(0.3, 0.7) * width
    for i in range(n):
        r0 = int(round(pitch[i] * ppd)) % hb
        c0 = int(round(yaw[i] * ppd)) % wb
        rows = (r0 + rows0) % hb
        cols = (c0 + cols0) % wb
        frame = bg[np.ix_(rows, cols)].copy()

        # A drifting "target" so the global-motion median has a moving
        # object to be robust against (kept clear of the muzzle-flash ROI).
        target_x += 1.5
        tx = int(target_x % (width - 80)) + 20
        ty = int(height * 0.16)
        cv2.rectangle(frame, (tx, ty), (tx + 46, ty + 92), (40, 40, 48), -1)

        # Muzzle flash on every 3rd firing frame (per-shot strobe).
        if firing[i] and (i % 3 == 0):
            r = int(rng.integers(70, 100))
            overlay = frame.copy()
            cv2.circle(overlay, flash_c, r, (205, 235, 255), -1)
            frame = cv2.addWeighted(overlay, 0.85, frame, 0.15, 0)

        vw.write(frame)
    vw.release()
    return written
