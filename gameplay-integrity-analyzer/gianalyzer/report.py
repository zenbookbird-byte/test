"""Render an AnalysisResult into report artifacts (PNG, HTML, JSON, TXT)."""

import base64
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

DISCLAIMER = (
    "This report is a HEURISTIC SCREENING aid based on video analysis only. "
    "It does NOT prove cheating. Aim assist, skilled play, recording artifacts "
    "and miscalibrated settings can all mimic these signals. Use it to decide "
    "what to review by hand and to support an official report - never as a "
    "public accusation."
)


def _figure(result, title, out_png):
    t = np.arange(result.n_frames) / result.eff_fps
    fig = plt.figure(figsize=(13, 11))
    gs = fig.add_gridspec(3, 2, height_ratios=[1, 1, 1], hspace=0.42, wspace=0.24)

    s = result.summary
    fig.suptitle(
        f"{title}\nAnomaly score: {s['anomaly_score']} / 100  [{s['band']}]",
        fontsize=15, fontweight="bold",
    )

    # Row 1: view angular velocity with firing bursts shaded.
    ax1 = fig.add_subplot(gs[0, :])
    ax1.plot(t, result.yaw_vel, lw=0.8, label="yaw vel", color="#1f77b4")
    ax1.plot(t, result.pitch_vel, lw=0.8, label="pitch vel", color="#ff7f0e")
    for b in result.bursts:
        ax1.axvspan(b.start_s, b.end_s, color="#d62728", alpha=0.12)
    ax1.set_title("View angular velocity (firing bursts shaded)")
    ax1.set_xlabel("time (s)")
    ax1.set_ylabel("deg / s")
    ax1.legend(loc="upper right", fontsize=8)
    ax1.grid(alpha=0.25)

    # Row 2: angular speed with snap threshold and snap peaks.
    ax2 = fig.add_subplot(gs[1, :])
    ax2.plot(t, result.speed, lw=0.8, color="#2ca02c")
    for b in result.bursts:
        if b.snap_to_fire:
            ax2.axvspan(b.start_s, b.end_s, color="#d62728", alpha=0.18)
    snap_t = [sn.peak_s for sn in result.snaps]
    snap_v = [sn.peak_speed for sn in result.snaps]
    if snap_t:
        ax2.scatter(snap_t, snap_v, color="#d62728", s=22, zorder=5, label="snap peak")
    ax2.set_title("Angular speed and aim-snap events (snap-to-fire bursts shaded)")
    ax2.set_xlabel("time (s)")
    ax2.set_ylabel("deg / s")
    if snap_t:
        ax2.legend(loc="upper right", fontsize=8)
    ax2.grid(alpha=0.25)

    # Row 3 left: recoil anomaly per burst.
    ax3 = fig.add_subplot(gs[2, 0])
    if result.bursts:
        idx = np.arange(1, len(result.bursts) + 1)
        vals = [b.recoil_anomaly for b in result.bursts]
        colors = ["#d62728" if v >= 0.6 else "#7f7f7f" for v in vals]
        ax3.bar(idx, vals, color=colors)
        ax3.set_xticks(idx)
    ax3.axhline(0.6, color="#d62728", ls="--", lw=1)
    ax3.set_ylim(0, 1)
    ax3.set_title("Recoil anomaly per burst")
    ax3.set_xlabel("burst #")
    ax3.set_ylabel("0 = natural .. 1 = flat/periodic")
    ax3.grid(alpha=0.25, axis="y")

    # Row 3 right: reaction-time proxy distribution.
    ax4 = fig.add_subplot(gs[2, 1])
    reactions = [b.reaction_s * 1000 for b in result.bursts if b.reaction_s is not None]
    if reactions:
        ax4.hist(reactions, bins=min(12, max(3, len(reactions))), color="#1f77b4")
    ax4.axvline(150, color="#d62728", ls="--", lw=1, label="150 ms")
    ax4.set_title("Reaction-time proxy (flick -> first shot)")
    ax4.set_xlabel("milliseconds")
    ax4.set_ylabel("bursts")
    ax4.legend(fontsize=8)
    ax4.grid(alpha=0.25, axis="y")

    fig.text(0.5, 0.005, DISCLAIMER, ha="center", va="bottom",
             fontsize=7.5, style="italic", wrap=True)
    fig.savefig(out_png, dpi=110, bbox_inches="tight")
    plt.close(fig)


def _to_jsonable(result, source):
    return {
        "source": source,
        "summary": result.summary,
        "disclaimer": DISCLAIMER,
        "bursts": [
            {
                "index": i + 1,
                "start_s": round(b.start_s, 3),
                "end_s": round(b.end_s, 3),
                "duration_s": round(b.dur_s, 3),
                "net_drift_deg": round(b.net_drift_deg, 3),
                "rel_jitter": round(b.rel_jitter, 3),
                "smoothness": round(b.smoothness, 3),
                "periodicity": round(b.periodicity, 3),
                "recoil_anomaly": round(b.recoil_anomaly, 3),
                "snap_to_fire": b.snap_to_fire,
                "reaction_s": round(b.reaction_s, 3) if b.reaction_s is not None else None,
            }
            for i, b in enumerate(result.bursts)
        ],
        "snaps": [
            {
                "time_s": round(sn.peak_s, 3),
                "peak_speed_dps": round(sn.peak_speed, 1),
                "superhuman": sn.superhuman,
            }
            for sn in result.snaps
        ],
        "review_moments": result.review_moments,
    }


def _text_report(data):
    s = data["summary"]
    lines = [
        "GAMEPLAY INTEGRITY ANALYZER - SCREENING REPORT",
        "=" * 52,
        f"Source        : {data['source']}",
        f"Duration      : {s['duration_s']} s ({s['n_frames']} frames @ {s['eff_fps']} fps)",
        "",
        f"ANOMALY SCORE : {s['anomaly_score']} / 100   [{s['band']}]",
        f"                {s['band_text']}",
        "",
        "Signals",
        "-" * 52,
        f"  Firing bursts        : {s['n_bursts']}",
        f"  Aim-snap events      : {s['n_snaps']}  (super-human: {s['superhuman_snaps']})",
        f"  Snap-to-fire bursts  : {s['n_snap_to_fire']}  (rate {s['snap_to_fire_rate']})",
        f"  Mean recoil anomaly  : {s['mean_recoil_anomaly']}",
        f"  Median reaction proxy: {s['median_reaction_s']} s",
        f"  Low-confidence frames: {s['low_confidence_frames']}",
    ]
    if s.get("note"):
        lines += ["", f"  NOTE: {s['note']}"]
    lines += ["", "Moments to review by hand", "-" * 52]
    if data["review_moments"]:
        for m in data["review_moments"]:
            lines.append(f"  [{m['time_s']:>7.2f}s] {m['severity'].upper():<6} "
                         f"{m['type']}: {m['detail']}")
    else:
        lines.append("  (none flagged)")
    lines += ["", "-" * 52, DISCLAIMER]
    return "\n".join(lines)


def _html_report(data, png_path):
    png_b64 = base64.b64encode(Path(png_path).read_bytes()).decode("ascii")
    s = data["summary"]
    band_color = {"LOW": "#2ca02c", "MODERATE": "#ff7f0e", "HIGH": "#d62728"}
    color = band_color.get(s["band"], "#7f7f7f")

    rows = "".join(
        f"<tr><td>{m['time_s']:.2f}s</td><td>{m['severity']}</td>"
        f"<td>{m['type']}</td><td>{m['detail']}</td></tr>"
        for m in data["review_moments"]
    ) or "<tr><td colspan='4'>None flagged</td></tr>"

    bursts = "".join(
        f"<tr><td>{b['index']}</td><td>{b['start_s']:.2f}s</td>"
        f"<td>{b['duration_s']:.2f}s</td><td>{b['recoil_anomaly']:.2f}</td>"
        f"<td>{b['smoothness']:.2f}</td><td>{b['periodicity']:.2f}</td>"
        f"<td>{'yes' if b['snap_to_fire'] else '-'}</td>"
        f"<td>{(str(round(b['reaction_s']*1000))+' ms') if b['reaction_s'] is not None else '-'}</td></tr>"
        for b in data["bursts"]
    ) or "<tr><td colspan='8'>No bursts detected</td></tr>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Integrity Screening Report</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;
   background:#10141a;color:#e6e6e6}}
 .wrap{{max-width:1080px;margin:0 auto;padding:32px}}
 h1{{font-size:20px;margin:0 0 4px}}
 .sub{{color:#8a93a0;font-size:13px;margin-bottom:24px}}
 .score{{display:inline-block;padding:14px 26px;border-radius:10px;
   background:{color};color:#10141a;font-weight:700;font-size:26px}}
 .band{{font-size:13px;color:#8a93a0;margin-top:8px}}
 table{{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}}
 th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid #232a35}}
 th{{color:#8a93a0;font-weight:600}}
 h2{{font-size:15px;margin-top:30px;border-left:3px solid {color};padding-left:10px}}
 img{{width:100%;border-radius:8px;margin-top:10px}}
 .disc{{margin-top:30px;padding:14px;background:#1a1f29;border-radius:8px;
   font-size:12px;color:#9aa3b0;line-height:1.5}}
</style></head><body><div class="wrap">
<h1>Gameplay Integrity Analyzer</h1>
<div class="sub">Screening report &middot; source: {data['source']}</div>
<div class="score">{s['anomaly_score']} / 100</div>
<div class="band">{s['band']} &mdash; {s['band_text']}</div>

<h2>Signals</h2>
<table>
<tr><th>Duration</th><td>{s['duration_s']} s ({s['n_frames']} frames @ {s['eff_fps']} fps)</td></tr>
<tr><th>Firing bursts</th><td>{s['n_bursts']}</td></tr>
<tr><th>Aim-snap events</th><td>{s['n_snaps']} (super-human: {s['superhuman_snaps']})</td></tr>
<tr><th>Snap-to-fire bursts</th><td>{s['n_snap_to_fire']} (rate {s['snap_to_fire_rate']})</td></tr>
<tr><th>Mean recoil anomaly</th><td>{s['mean_recoil_anomaly']}</td></tr>
<tr><th>Median reaction proxy</th><td>{s['median_reaction_s']} s</td></tr>
<tr><th>Low-confidence frames</th><td>{s['low_confidence_frames']}</td></tr>
</table>

<h2>Timeline</h2>
<img src="data:image/png;base64,{png_b64}" alt="analysis figure">

<h2>Moments to review by hand</h2>
<table><tr><th>Time</th><th>Severity</th><th>Type</th><th>Detail</th></tr>
{rows}</table>

<h2>Per-burst detail</h2>
<table><tr><th>#</th><th>Start</th><th>Dur</th><th>Recoil anomaly</th>
<th>Smoothness</th><th>Periodicity</th><th>Snap-to-fire</th><th>Reaction</th></tr>
{bursts}</table>

<div class="disc"><b>Disclaimer.</b> {DISCLAIMER}</div>
</div></body></html>"""


def render(result, out_dir, title, source):
    """Write figure.png, report.html, report.json and report.txt."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    png = out_dir / "figure.png"
    _figure(result, title, png)

    data = _to_jsonable(result, source)
    (out_dir / "report.json").write_text(json.dumps(data, indent=2))
    (out_dir / "report.txt").write_text(_text_report(data))
    (out_dir / "report.html").write_text(_html_report(data, png))
    return out_dir
