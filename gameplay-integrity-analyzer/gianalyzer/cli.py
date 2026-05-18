"""Command-line interface for the Gameplay Integrity Analyzer."""

import argparse
import sys
import time
from pathlib import Path

from gianalyzer import __version__
from gianalyzer.config import AnalyzerConfig
from gianalyzer.metrics import analyze
from gianalyzer.report import render
from gianalyzer.signals import extract_signals
from gianalyzer.synth import generate_clip
from gianalyzer.video import VideoReader

BANNER = "Gameplay Integrity Analyzer v" + __version__


def _progress(quiet):
    if quiet:
        return None
    state = {"t": 0.0}

    def cb(done, total):
        now = time.time()
        if now - state["t"] < 0.2 and done != total:
            return
        state["t"] = now
        if total:
            pct = 100.0 * done / total
            sys.stderr.write(f"\r  analysing frames... {done}/{total} ({pct:5.1f}%)")
        else:
            sys.stderr.write(f"\r  analysing frames... {done}")
        sys.stderr.flush()
        if done == total and total:
            sys.stderr.write("\n")

    return cb


def _config_from_args(args):
    cfg = AnalyzerConfig()
    if getattr(args, "fov", None):
        cfg.fov_h = args.fov
    if getattr(args, "work_width", None):
        cfg.work_width = args.work_width
    if getattr(args, "stride", None):
        cfg.frame_stride = args.stride
    if getattr(args, "max_frames", None):
        cfg.max_frames = args.max_frames
    if getattr(args, "fire_roi", None):
        cfg.fire_roi = tuple(args.fire_roi)
    if getattr(args, "fire_threshold", None) is not None:
        cfg.fire_threshold = args.fire_threshold
    if getattr(args, "snap_threshold", None) is not None:
        cfg.snap_threshold_dps = args.snap_threshold
    cfg.validate()
    return cfg


def run_analysis(video_path, cfg, out_dir, title, quiet=False):
    """Analyse one video and write its report. Returns the AnalysisResult."""
    reader = VideoReader(video_path, cfg.work_width, cfg.frame_stride, cfg.max_frames)
    signals = extract_signals(reader, cfg, progress=_progress(quiet))
    result = analyze(signals, cfg)
    render(result, out_dir, title=title, source=str(video_path))
    return result


def _print_summary(result, out_dir):
    s = result.summary
    print()
    print(f"  ANOMALY SCORE : {s['anomaly_score']} / 100  [{s['band']}]")
    print(f"                  {s['band_text']}")
    print(f"  firing bursts : {s['n_bursts']}   "
          f"snap-to-fire: {s['n_snap_to_fire']}   "
          f"super-human snaps: {s['superhuman_snaps']}")
    print(f"  mean recoil anomaly: {s['mean_recoil_anomaly']}   "
          f"median reaction proxy: {s['median_reaction_s']} s")
    if s.get("note"):
        print(f"  note: {s['note']}")
    if result.review_moments:
        print("  moments to review:")
        for m in result.review_moments[:8]:
            print(f"    [{m['time_s']:>7.2f}s] {m['detail']}")
        extra = len(result.review_moments) - 8
        if extra > 0:
            print(f"    ... and {extra} more (see report)")
    print(f"  report written to: {out_dir}")


def cmd_analyze(args):
    cfg = _config_from_args(args)
    video = Path(args.video)
    if not video.exists():
        print(f"error: video not found: {video}", file=sys.stderr)
        return 2
    out_dir = Path(args.output)
    print(f"{BANNER}\nAnalysing: {video}")
    result = run_analysis(video, cfg, out_dir, title=video.name, quiet=args.quiet)
    _print_summary(result, out_dir)
    return 0


def cmd_synth(args):
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"{BANNER}\nGenerating {args.profile} clip: {out}")
    written = generate_clip(out, profile=args.profile, seconds=args.seconds,
                            seed=args.seed)
    print(f"  written: {written}")
    return 0


def cmd_demo(args):
    out_dir = Path(args.output)
    clips_dir = out_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    cfg = AnalyzerConfig()
    cfg.validate()

    print(f"{BANNER}\nDemo: generating two synthetic clips, then analysing both.\n")
    results = {}
    for profile in ("clean", "macro"):
        print(f"[{profile}] generating synthetic clip...")
        clip = generate_clip(clips_dir / f"{profile}.mp4", profile=profile,
                             seconds=args.seconds, seed=args.seed)
        print(f"[{profile}] analysing...")
        rep_dir = out_dir / "reports" / profile
        result = run_analysis(clip, cfg, rep_dir,
                              title=f"Synthetic demo - {profile} profile",
                              quiet=args.quiet)
        results[profile] = result
        _print_summary(result, rep_dir)
        print()

    print("=" * 60)
    print("DEMO COMPARISON")
    print("=" * 60)
    for profile, result in results.items():
        s = result.summary
        print(f"  {profile:6s}: score {s['anomaly_score']:>5} / 100  [{s['band']}]")
    print("\nThe analyzer should score the 'macro' clip well above the")
    print("'clean' clip. Open the report.html files to see the breakdown.")
    print("Reminder: this is a screening heuristic, not proof of cheating.")
    return 0


def build_parser():
    p = argparse.ArgumentParser(
        prog="gianalyzer",
        description=BANNER + " - heuristic, video-only anomaly screening "
                    "for gameplay footage (screening aid, not proof).",
    )
    p.add_argument("--version", action="version", version=BANNER)
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("analyze", help="analyse a gameplay video file")
    a.add_argument("video", help="path to the video file")
    a.add_argument("-o", "--output", default="output/analysis",
                   help="output directory for the report")
    a.add_argument("--fov", type=float, help="horizontal field of view (deg)")
    a.add_argument("--work-width", type=int, help="analysis downscale width")
    a.add_argument("--stride", type=int, help="process every Nth frame")
    a.add_argument("--max-frames", type=int, help="limit number of frames")
    a.add_argument("--fire-roi", type=float, nargs=4,
                   metavar=("X0", "Y0", "X1", "Y1"),
                   help="muzzle-flash ROI as fractions of the frame")
    a.add_argument("--fire-threshold", type=float,
                   help="brightness spike threshold for firing detection")
    a.add_argument("--snap-threshold", type=float,
                   help="angular speed (deg/s) counted as an aim snap")
    a.add_argument("-q", "--quiet", action="store_true", help="suppress progress")
    a.set_defaults(func=cmd_analyze)

    d = sub.add_parser("demo", help="generate synthetic clips and analyse them")
    d.add_argument("-o", "--output", default="output/demo",
                   help="output directory")
    d.add_argument("--seconds", type=int, default=12, help="clip length")
    d.add_argument("--seed", type=int, default=7, help="random seed")
    d.add_argument("-q", "--quiet", action="store_true", help="suppress progress")
    d.set_defaults(func=cmd_demo)

    s = sub.add_parser("synth", help="generate a single synthetic clip")
    s.add_argument("-o", "--output", default="output/clip.mp4",
                   help="output video path")
    s.add_argument("--profile", choices=("clean", "macro"), default="macro",
                   help="behaviour profile to synthesise")
    s.add_argument("--seconds", type=int, default=12, help="clip length")
    s.add_argument("--seed", type=int, default=7, help="random seed")
    s.set_defaults(func=cmd_synth)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
