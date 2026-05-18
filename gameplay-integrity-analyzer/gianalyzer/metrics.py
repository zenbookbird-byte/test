"""Turn raw signals into anomaly metrics and an overall screening score.

All thresholds are heuristics. The output is designed to point a human
reviewer at moments worth watching, not to deliver a verdict.
"""

from dataclasses import dataclass, field

import numpy as np

# Scoring weights (sum to 1.0). Exposed here so they are easy to audit/tune.
W_SNAP_TO_FIRE = 0.45
W_RECOIL = 0.40
W_SUPERHUMAN = 0.15

# A snap faster than this multiple of the snap threshold is "superhuman".
SUPERHUMAN_FACTOR = 2.2

# Bursts shorter than this many frames are not autocorrelated for periodicity.
MIN_AUTOCORR_FRAMES = 8

_EPS = 1e-9


@dataclass
class Burst:
    start: int
    end: int
    start_s: float
    end_s: float
    dur_s: float
    net_drift_deg: float          # net vertical view travel across the burst
    rel_jitter: float             # frame-to-frame change / overall amplitude
    smoothness: float             # 0..1, high = unnaturally smooth
    periodicity: float            # 0..1, high = repeating per-shot pattern
    recoil_anomaly: float         # 0..1, combined recoil flag
    snap_to_fire: bool = False
    reaction_s: float = None


@dataclass
class Snap:
    peak_frame: int
    peak_s: float
    peak_speed: float
    superhuman: bool


@dataclass
class AnalysisResult:
    eff_fps: float
    n_frames: int
    duration_s: float
    yaw_vel: np.ndarray
    pitch_vel: np.ndarray
    speed: np.ndarray
    fire_brightness: np.ndarray
    fire_baseline: np.ndarray
    firing: np.ndarray
    bursts: list
    snaps: list
    summary: dict = field(default_factory=dict)
    review_moments: list = field(default_factory=list)


def _rolling_median(x, win):
    win = max(1, int(win))
    if win % 2 == 0:
        win += 1
    half = win // 2
    pad = np.pad(x, half, mode="edge")
    out = np.empty_like(x, dtype=float)
    for i in range(len(x)):
        out[i] = np.median(pad[i : i + win])
    return out


def _group_runs(flags, merge_gap, min_len):
    """Group True runs in a boolean array, merging short gaps."""
    runs = []
    cur = None
    for i, f in enumerate(flags):
        if f:
            cur = [i, i] if cur is None else [cur[0], i]
        elif cur is not None and i - cur[1] > merge_gap:
            runs.append(tuple(cur))
            cur = None
    if cur is not None:
        runs.append(tuple(cur))

    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(list(r))
    return [(a, b) for a, b in merged if (b - a + 1) >= min_len]


def _max_autocorrelation(sig):
    """Largest normalised autocorrelation peak at lag >= 2."""
    sig = np.asarray(sig, dtype=float)
    sig = sig - sig.mean()
    energy = float(np.dot(sig, sig))
    if energy < _EPS or len(sig) < MIN_AUTOCORR_FRAMES:
        return 0.0
    ac = np.correlate(sig, sig, mode="full")[len(sig) - 1 :]
    ac = ac / ac[0]
    seg = ac[2 : max(3, len(ac) // 2)]
    return float(np.clip(seg.max(), 0.0, 1.0)) if len(seg) else 0.0


def _angular_velocity(signals, cfg):
    """Convert pixel motion to view angular velocity in degrees/second.

    deg-per-pixel = fov_h / work_width; multiply by effective fps to get a
    rate. The view turns opposite to the scene motion, hence the negation.
    """
    deg_per_px = cfg.fov_h / signals.work_width
    yaw = -signals.dx * deg_per_px * signals.eff_fps
    pitch = -signals.dy * deg_per_px * signals.eff_fps
    return yaw, pitch


def _detect_firing(signals, cfg):
    baseline_win = max(3, round(cfg.fire_baseline_sec * signals.eff_fps))
    baseline = _rolling_median(signals.fire_brightness, baseline_win)
    firing = (signals.fire_brightness - baseline) > cfg.fire_threshold
    return baseline, firing


def _analyse_recoil(pitch_vel, start, end, eff_fps):
    seg = pitch_vel[start : end + 1]
    if len(seg) < 3:
        return 0.0, 0.0, 0.0, 0.0, 0.0
    net_drift = float(np.sum(seg) / eff_fps)
    amp = float(np.std(seg))
    diff_amp = float(np.std(np.diff(seg)))
    rel_jitter = diff_amp / (amp + _EPS)
    # Human aiming is jittery (rel_jitter ~1+); a macro's compensation is
    # smooth (rel_jitter well below 1).
    smoothness = float(np.clip((1.4 - rel_jitter) / 1.4, 0.0, 1.0))
    periodicity = _max_autocorrelation(seg)
    # Smoothness is weighted higher: it is reliable on the short bursts
    # typical of footage, whereas periodicity needs several shot cycles.
    recoil_anomaly = float(np.clip(0.6 * smoothness + 0.4 * periodicity, 0.0, 1.0))
    return net_drift, rel_jitter, smoothness, periodicity, recoil_anomaly


def _band(score):
    if score < 35:
        return "LOW", "No strong anomalies detected."
    if score < 65:
        return "MODERATE", "Some anomalies present - manual review advised."
    return "HIGH", "Multiple strong anomalies - manual review strongly advised."


def analyze(signals, cfg):
    """Full analysis: produce an AnalysisResult from RawSignals."""
    eff_fps = signals.eff_fps
    yaw, pitch = _angular_velocity(signals, cfg)
    speed = np.hypot(yaw, pitch)
    duration_s = signals.n_frames / eff_fps if eff_fps else 0.0

    baseline, firing = _detect_firing(signals, cfg)

    # --- firing bursts ---
    merge_gap = round(cfg.burst_merge_gap_sec * eff_fps)
    min_len = max(2, round(cfg.burst_min_sec * eff_fps))
    burst_runs = _group_runs(firing, merge_gap, min_len)

    # --- aim-snap events ---
    snap_runs = _group_runs(speed > cfg.snap_threshold_dps, merge_gap=1, min_len=1)
    snaps = []
    for s, e in snap_runs:
        seg = speed[s : e + 1]
        peak_local = int(np.argmax(seg))
        peak_frame = s + peak_local
        peak_speed = float(seg[peak_local])
        snaps.append(Snap(
            peak_frame=peak_frame,
            peak_s=peak_frame / eff_fps,
            peak_speed=peak_speed,
            superhuman=peak_speed > cfg.snap_threshold_dps * SUPERHUMAN_FACTOR,
        ))

    # --- per-burst recoil + snap-to-fire + reaction proxy ---
    s2f_window = cfg.snap_to_fire_window_sec * eff_fps
    lookback = cfg.reaction_lookback_sec * eff_fps
    bursts = []
    for s, e in burst_runs:
        net, relj, smooth, period, anomaly = _analyse_recoil(pitch, s, e, eff_fps)

        preceding = [sn for sn in snaps if (s - lookback) <= sn.peak_frame <= s + 2]
        snap_to_fire = any((s - sn.peak_frame) <= s2f_window for sn in preceding)
        reaction_s = None
        if preceding:
            nearest = min(preceding, key=lambda sn: abs(s - sn.peak_frame))
            reaction_s = max(0.0, (s - nearest.peak_frame) / eff_fps)

        bursts.append(Burst(
            start=s, end=e,
            start_s=s / eff_fps, end_s=e / eff_fps,
            dur_s=(e - s + 1) / eff_fps,
            net_drift_deg=net, rel_jitter=relj,
            smoothness=smooth, periodicity=period, recoil_anomaly=anomaly,
            snap_to_fire=snap_to_fire, reaction_s=reaction_s,
        ))

    # --- overall score ---
    n_bursts = len(bursts)
    n_s2f = sum(b.snap_to_fire for b in bursts)
    superhuman = sum(s.superhuman for s in snaps)
    mean_recoil = float(np.mean([b.recoil_anomaly for b in bursts])) if bursts else 0.0
    s2f_rate = n_s2f / n_bursts if n_bursts else 0.0
    superhuman_score = float(np.clip(superhuman / max(3, n_bursts), 0.0, 1.0))

    score01 = (W_SNAP_TO_FIRE * s2f_rate
               + W_RECOIL * mean_recoil
               + W_SUPERHUMAN * superhuman_score)
    score = round(100.0 * float(np.clip(score01, 0.0, 1.0)), 1)
    band, band_text = _band(score)

    reactions = [b.reaction_s for b in bursts if b.reaction_s is not None]
    low_conf = int(np.sum(signals.confidence < 0.15))
    summary = {
        "anomaly_score": score,
        "band": band,
        "band_text": band_text,
        "duration_s": round(duration_s, 2),
        "n_frames": signals.n_frames,
        "eff_fps": round(eff_fps, 2),
        "n_bursts": n_bursts,
        "n_snaps": len(snaps),
        "n_snap_to_fire": n_s2f,
        "snap_to_fire_rate": round(s2f_rate, 3),
        "superhuman_snaps": superhuman,
        "mean_recoil_anomaly": round(mean_recoil, 3),
        "median_reaction_s": round(float(np.median(reactions)), 3) if reactions else None,
        "reaction_times_s": [round(r, 3) for r in reactions],
        "low_confidence_frames": low_conf,
    }
    if n_bursts == 0:
        summary["note"] = ("No firing activity detected - check --fire-roi "
                           "and --fire-threshold for this footage.")
    elif low_conf > 0.1 * max(1, signals.n_frames):
        summary["note"] = (f"{low_conf} frames had low motion-tracking "
                           "confidence (very fast motion or scene cuts); "
                           "metrics on those frames are unreliable.")

    result = AnalysisResult(
        eff_fps=eff_fps, n_frames=signals.n_frames, duration_s=duration_s,
        yaw_vel=yaw, pitch_vel=pitch, speed=speed,
        fire_brightness=signals.fire_brightness, fire_baseline=baseline,
        firing=firing, bursts=bursts, snaps=snaps, summary=summary,
    )
    result.review_moments = _review_moments(result, cfg)
    return result


def _review_moments(result, cfg):
    moments = []
    for i, b in enumerate(result.bursts):
        reasons = []
        if b.snap_to_fire:
            reasons.append(f"snap-to-fire (reaction proxy {b.reaction_s * 1000:.0f} ms)")
        if b.recoil_anomaly >= 0.6:
            reasons.append(
                f"flat/periodic recoil (smoothness {b.smoothness:.2f}, "
                f"periodicity {b.periodicity:.2f})")
        if not reasons:
            continue
        severity = "high" if (b.snap_to_fire and b.recoil_anomaly >= 0.6) else "review"
        moments.append({
            "time_s": round(b.start_s, 2),
            "type": "firing burst",
            "detail": f"Burst #{i + 1}: " + "; ".join(reasons),
            "severity": severity,
        })
    for sn in result.snaps:
        if sn.superhuman:
            moments.append({
                "time_s": round(sn.peak_s, 2),
                "type": "aim snap",
                "detail": f"Super-human snap: {sn.peak_speed:.0f} deg/s",
                "severity": "review",
            })
    moments.sort(key=lambda m: m["time_s"])
    return moments
