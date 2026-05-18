"""Tunable configuration for the analysis pipeline."""

from dataclasses import dataclass


@dataclass
class AnalyzerConfig:
    # --- frame handling ---
    work_width: int = 480          # frames are downscaled to this width for analysis
    frame_stride: int = 1          # process every Nth frame (>=1)
    max_frames: int = 0            # 0 = no limit

    # --- camera / optics ---
    fov_h: float = 90.0            # horizontal field of view in degrees (game dependent)

    # --- HUD masking (fractions of frame height) ---
    hud_top_frac: float = 0.04     # ignore top strip during motion estimation
    hud_bottom_frac: float = 0.18  # ignore bottom strip (ammo/minimap HUD)

    # --- firing detection ---
    # Region of interest where the muzzle flash appears, as (x0, y0, x1, y1)
    # fractions of the frame. Default is a centred lower-mid box.
    fire_roi: tuple = (0.44, 0.46, 0.56, 0.74)
    fire_threshold: float = 16.0   # brightness spike above rolling baseline (0-255)
    fire_baseline_sec: float = 0.6 # rolling-median window for the brightness baseline
    burst_merge_gap_sec: float = 0.12  # merge firing frames separated by <= this gap
    burst_min_sec: float = 0.10    # discard bursts shorter than this

    # --- aim-snap detection ---
    # Angular speed above this counts as a "snap" (a fast view movement).
    # Kept within the range 30 fps video can reliably measure; the
    # incriminating signal is snap-to-fire correlation, not raw speed.
    snap_threshold_dps: float = 400.0
    snap_to_fire_window_sec: float = 0.20  # snap this close before a burst = snap-to-fire
    reaction_lookback_sec: float = 1.0  # how far back to search for the engaging flick

    def validate(self) -> None:
        if self.work_width < 160:
            raise ValueError("work_width must be >= 160")
        if self.frame_stride < 1:
            raise ValueError("frame_stride must be >= 1")
        if not (10.0 < self.fov_h < 179.0):
            raise ValueError("fov_h must be between 10 and 179 degrees")
        x0, y0, x1, y1 = self.fire_roi
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError("fire_roi must be ordered fractions within [0, 1]")
