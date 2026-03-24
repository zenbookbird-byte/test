#!/usr/bin/env python3
"""
Scheduled runner for the Polymarket copy-trade bot.
Runs the full analysis pipeline on a configurable interval,
sends alerts, checks watchlist, and keeps outputs fresh.

Usage:
  python scheduler.py                  # run once immediately
  python scheduler.py --loop 60        # run every 60 minutes
  python scheduler.py --loop 30 --dry  # dry run (no alerts sent)
  python scheduler.py --cron           # emit a crontab line and exit

Environment / alerts_config.json controls alert destinations.
"""

import argparse
import importlib
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone


# ── Logging ───────────────────────────────────────────────────────────────────
LOG_FILE = "scheduler.log"


def log(msg: str, level: str = "INFO"):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def log_separator():
    line = "═" * 72
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


# ── Run the analysis pipeline ─────────────────────────────────────────────────
def run_analysis(dry: bool = False) -> dict:
    """
    Import and run the full analysis, returning the results dict
    so we can pass them to alerts and watchlist without re-running.
    """
    log("Starting analysis pipeline...")
    start = time.time()

    try:
        # Import the analysis module fresh each run so config changes take effect
        if "polymarket_wallet_analysis" in sys.modules:
            del sys.modules["polymarket_wallet_analysis"]
        pma = importlib.import_module("polymarket_wallet_analysis")

        # Run main() — it writes JSON files we'll read back
        pma.main()

        elapsed = time.time() - start
        log(f"Analysis complete in {elapsed:.1f}s")

        # Read the outputs back
        results = {}
        for fname in ("war_wallet_rankings.json", "copy_signals.json", "advanced_signals.json"):
            if os.path.exists(fname):
                with open(fname) as f:
                    results[fname] = json.load(f)

        return results
    except Exception as e:
        log(f"Analysis failed: {e}", level="ERROR")
        traceback.print_exc()
        return {}


# ── Post-run: alerts + watchlist ──────────────────────────────────────────────
def post_run(results: dict, dry: bool = False):
    """Send alerts and check watchlist after analysis completes."""
    try:
        import alerts as alert_mod
        import watchlist as wl_mod

        cfg = alert_mod.load_config()
        if dry:
            cfg["telegram_token"] = ""
            cfg["discord_webhook"] = ""
            log("[DRY RUN] Alert destinations disabled.")

        # Load outputs
        rankings = results.get("war_wallet_rankings.json", {})
        signals  = results.get("copy_signals.json", [])
        advanced = results.get("advanced_signals.json", {})

        all_rows = rankings.get("winrate_ranking", [])
        market_titles = {}
        for s in signals:
            mid = s.get("market_id") or s.get("market_title", "")[:16]
            market_titles[mid] = s.get("market_title", mid)

        # Check watchlist
        wl_hits = wl_mod.check_watchlist(all_rows, market_titles)
        wl_mod.print_watchlist_hits(wl_hits)

        # Dispatch alerts
        log(f"Dispatching alerts ({len(signals)} copy signals, "
            f"{len(advanced.get('convergence_events',[]))} convergence, "
            f"{len(advanced.get('exit_signals',[]))} exits, "
            f"{len(advanced.get('contrarian_signals',[]))} contrarian)...")

        alert_mod.dispatch_alerts(
            cfg            = cfg,
            copy_signals   = signals,
            convergence_events = advanced.get("convergence_events", []),
            exit_signals       = advanced.get("exit_signals", []),
            contrarian_signals = advanced.get("contrarian_signals", []),
            market_titles      = market_titles,
            watchlist_hits     = wl_hits,
        )
    except ImportError as e:
        log(f"Could not import alerts/watchlist: {e}", level="WARN")
    except Exception as e:
        log(f"Post-run error: {e}", level="ERROR")
        traceback.print_exc()


# ── Health summary ────────────────────────────────────────────────────────────
def print_health(results: dict):
    rankings = results.get("war_wallet_rankings.json", {})
    signals  = results.get("copy_signals.json", [])
    advanced = results.get("advanced_signals.json", {})

    n_wallets    = len(rankings.get("winrate_ranking", []))
    n_signals    = len(signals)
    n_conv       = len(advanced.get("convergence_events", []))
    n_exit       = len(advanced.get("exit_signals", []))
    n_contra     = len(advanced.get("contrarian_signals", []))
    n_sybil      = len(advanced.get("sybil_clusters", {}))
    generated_at = rankings.get("generated_at", "—")

    log_separator()
    log(f"Run complete @ {generated_at}")
    log(f"  Wallets scored   : {n_wallets}")
    log(f"  Copy signals     : {n_signals}")
    log(f"  Convergence      : {n_conv}")
    log(f"  Exit signals     : {n_exit}")
    log(f"  Contrarian edges : {n_contra}")
    log(f"  Sybil clusters   : {n_sybil}")
    log_separator()


# ── Main loop ─────────────────────────────────────────────────────────────────
def run_once(dry: bool = False):
    log_separator()
    log("Polymarket Bot — scheduled run starting")
    results = run_analysis(dry=dry)
    if results:
        print_health(results)
        post_run(results, dry=dry)
    else:
        log("No results — skipping post-run.", level="WARN")


def run_loop(interval_mins: int, dry: bool = False):
    log(f"Scheduler starting — interval: {interval_mins}m  dry={dry}")
    run_count = 0
    while True:
        run_count += 1
        log(f"── Run #{run_count} ──")
        try:
            run_once(dry=dry)
        except KeyboardInterrupt:
            log("Interrupted by user — stopping.")
            break
        except Exception as e:
            log(f"Unhandled error in run #{run_count}: {e}", level="ERROR")
            traceback.print_exc()

        next_run = datetime.now(timezone.utc)
        log(f"Sleeping {interval_mins}m until next run...")
        try:
            time.sleep(interval_mins * 60)
        except KeyboardInterrupt:
            log("Interrupted during sleep — stopping.")
            break


def emit_cron(interval_mins: int = 60):
    """Print a crontab line to run the bot on a schedule."""
    script_path = os.path.abspath(__file__)
    python_path = sys.executable
    log_path    = os.path.join(os.path.dirname(script_path), "scheduler.log")

    if interval_mins >= 60 and interval_mins % 60 == 0:
        hours = interval_mins // 60
        cron_time = f"0 */{hours} * * *" if hours > 1 else "0 * * * *"
    else:
        cron_time = f"*/{interval_mins} * * * *"

    print("\n── Add this to your crontab (crontab -e) ──────────────────────────────")
    print(f"{cron_time}  {python_path} {script_path} >> {log_path} 2>&1")
    print("───────────────────────────────────────────────────────────────────────")
    print(f"\nThis will run the bot every {interval_mins} minute(s).")
    print("Make sure your TELEGRAM_BOT_TOKEN / DISCORD_WEBHOOK_URL env vars are")
    print("exported in your shell profile (~/.bashrc or ~/.profile).\n")


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Polymarket bot scheduler")
    parser.add_argument("--loop", type=int, metavar="MINS",
                        help="Run on a loop every N minutes")
    parser.add_argument("--dry", action="store_true",
                        help="Dry run — no alerts sent")
    parser.add_argument("--cron", action="store_true",
                        help="Print crontab line and exit")
    args = parser.parse_args()

    if args.cron:
        emit_cron(args.loop or 60)
        return

    if args.loop:
        run_loop(args.loop, dry=args.dry)
    else:
        run_once(dry=args.dry)


if __name__ == "__main__":
    main()
