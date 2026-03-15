#!/usr/bin/env python3
"""
monthly_trial.py — 30-Day Copy-Trade Trial Manager
====================================================
Manages a structured 30-day paper-trade trial on Polymarket crypto markets
(BTC, ETH, SOL) using the copy_trader.py bot.

WHAT IT DOES
------------
• Daily run: re-scouts wallets, logs today's P&L snapshot, sends Telegram summary
• End of month: generates a full performance report across all 30 days
• Safety rails: auto-pause if daily loss exceeds stop-loss limit
• Low capital by design: $50 total / $5 max per trade

USAGE
-----
  python monthly_trial.py --start            # begin a new trial (resets log)
  python monthly_trial.py --day              # run daily snapshot (call via cron)
  python monthly_trial.py --report           # print final 30-day report
  python monthly_trial.py --status           # show current trial progress

CRON SETUP (run at midnight UTC every day during trial)
  0 0 * * * cd /home/youruser/bot && python monthly_trial.py --day >> logs/trial_cron.log 2>&1

AFTER THE TRIAL
---------------
  1. Run --report to see which coin and which wallets performed best
  2. The best-performing coin's wallet list becomes your live-trade target
  3. Raise COPY_BUDGET_USDC and set PAPER_TRADE=false in .env
  4. Run python wallet_scout.py weekly to keep the wallet list fresh

DATA FILES
----------
  data/trial_state.json    — trial metadata (start date, settings)
  data/trial_log.json      — daily P&L log (30 entries)
  data/crypto_wallets.json — wallet list refreshed daily by wallet_scout
"""

import argparse, json, os, sys, time, logging, subprocess
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict

# ─────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('monthly_trial')

# ─────────────────────────────────────────────────────────────
#  Config
# ─────────────────────────────────────────────────────────────
TRIAL_DAYS        = 30
DAILY_BUDGET      = float(os.getenv('TRIAL_DAILY_BUDGET', '50'))   # USDC per day
MAX_POSITION      = float(os.getenv('TRIAL_MAX_POSITION', '5'))    # per trade
DAILY_STOP_LOSS   = float(os.getenv('TRIAL_DAILY_STOP', '-15'))    # pause if day < this
MONTHLY_STOP_LOSS = float(os.getenv('TRIAL_MONTHLY_STOP', '-80'))  # halt if total < this
COINS             = ['BTC', 'ETH', 'SOL']

STATE_FILE  = 'data/trial_state.json'
LOG_FILE    = 'data/trial_log.json'
BOT_STATE   = 'bot_state.json'

# ─────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────
def _today() -> str:
    return date.today().isoformat()

def _read_json(path: str, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}

def _write_json(path: str, data):
    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def _send_telegram(msg: str):
    """Send a message via the Telegram bot if configured."""
    token   = os.getenv('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '')
    if not token or not chat_id:
        return
    try:
        import requests as _r
        _r.post(
            f'https://api.telegram.org/bot{token}/sendMessage',
            json={'chat_id': chat_id, 'text': msg, 'parse_mode': 'Markdown'},
            timeout=10,
        )
    except Exception as e:
        log.debug(f'Telegram send failed: {e}')

def _run_wallet_scout(coin: str = 'ALL'):
    """Re-run wallet_scout.py to refresh the wallet list."""
    log.info(f'Refreshing wallet list (coin={coin})…')
    try:
        result = subprocess.run(
            [sys.executable, 'wallet_scout.py', '--coin', coin, '--days', '90'],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            log.info('Wallet scout complete')
        else:
            log.warning(f'Wallet scout exited {result.returncode}: {result.stderr[:200]}')
    except subprocess.TimeoutExpired:
        log.warning('Wallet scout timed out (>5min) — using existing wallet list')
    except FileNotFoundError:
        log.warning('wallet_scout.py not found — skipping wallet refresh')

# ─────────────────────────────────────────────────────────────
#  Trial state management
# ─────────────────────────────────────────────────────────────
def load_state() -> dict:
    return _read_json(STATE_FILE, {})

def save_state(state: dict):
    _write_json(STATE_FILE, state)

def load_log() -> list:
    return _read_json(LOG_FILE, [])

def save_log(log_entries: list):
    _write_json(LOG_FILE, log_entries)

def trial_is_active(state: dict) -> bool:
    if not state.get('started_at'):
        return False
    start = date.fromisoformat(state['started_at'])
    return (date.today() - start).days < TRIAL_DAYS

def day_number(state: dict) -> int:
    if not state.get('started_at'):
        return 0
    start = date.fromisoformat(state['started_at'])
    return (date.today() - start).days + 1

# ─────────────────────────────────────────────────────────────
#  Read current bot state
# ─────────────────────────────────────────────────────────────
def read_bot_snapshot() -> dict:
    """Read today's P&L from bot_state.json (written by copy_trader.py)."""
    s = _read_json(BOT_STATE, {})
    if s.get('error') or not s:
        return {
            'today_pnl': 0.0,
            'wins':      0,
            'losses':    0,
            'positions': {},
            'mode':      'unknown',
        }
    return {
        'today_pnl': s.get('today_pnl', 0.0),
        'wins':      s.get('wins', 0),
        'losses':    s.get('losses', 0),
        'positions': s.get('positions', {}),
        'mode':      s.get('mode', '?'),
        'started_at': s.get('started_at', ''),
    }

# ─────────────────────────────────────────────────────────────
#  Commands
# ─────────────────────────────────────────────────────────────
def cmd_start(args):
    """Begin a new 30-day trial. Resets all logs."""
    state = load_state()
    if state.get('started_at') and trial_is_active(state):
        dn = day_number(state)
        log.warning(
            f'Trial already active (Day {dn}/{TRIAL_DAYS}, started {state["started_at"]}).\n'
            f'Run --report first, then --start to begin a new trial.'
        )
        yn = input('Force reset? [y/N] ').strip().lower()
        if yn != 'y':
            sys.exit(0)

    today = _today()
    state = {
        'started_at':    today,
        'daily_budget':  DAILY_BUDGET,
        'max_position':  MAX_POSITION,
        'daily_stop':    DAILY_STOP_LOSS,
        'monthly_stop':  MONTHLY_STOP_LOSS,
        'coins':         COINS,
        'paper_trade':   True,
        'version':       '1.0',
    }
    save_state(state)
    save_log([])

    log.info(f'Trial started: {today}')
    log.info(f'Settings: ${DAILY_BUDGET}/day budget, ${MAX_POSITION} max/trade, paper mode ON')

    # Refresh wallets on day 1
    _run_wallet_scout()

    print()
    print('═' * 60)
    print('  30-Day Copy-Trade Trial — STARTED')
    print('═' * 60)
    print(f'  Start date  : {today}')
    print(f'  End date    : {(date.fromisoformat(today) + timedelta(days=29)).isoformat()}')
    print(f'  Daily budget: ${DAILY_BUDGET:.2f} USDC (paper)')
    print(f'  Max per trade: ${MAX_POSITION:.2f} USDC')
    print(f'  Daily stop  : ${DAILY_STOP_LOSS:.2f}')
    print(f'  Monthly stop: ${MONTHLY_STOP_LOSS:.2f}')
    print(f'  Coins       : {", ".join(COINS)}')
    print()
    print('  Start the bot in a separate terminal:')
    print('    MODE=btc COPY_BUDGET_USDC=50 MAX_POSITION_USDC=5 PAPER_TRADE=true \\')
    print('      python copy_trader.py')
    print()
    print('  Add daily snapshot to cron:')
    print('    0 0 * * * cd /path/to/bot && python monthly_trial.py --day')
    print()

    _send_telegram(
        f'🚀 *30-Day Trial Started*\n'
        f'Day 1/{TRIAL_DAYS} • {today}\n'
        f'Budget: ${DAILY_BUDGET}/day paper • max ${MAX_POSITION}/trade\n'
        f'Coins: {", ".join(COINS)}\n'
        f'Run `python monthly_trial.py --day` daily at midnight.'
    )


def cmd_day(args):
    """Daily snapshot — call from cron at midnight."""
    state = load_state()
    if not state.get('started_at'):
        log.error('No active trial. Run --start first.')
        sys.exit(1)

    entries = load_log()
    dn = day_number(state)
    today = _today()

    # Avoid duplicate entries for the same date
    if entries and entries[-1].get('date') == today:
        log.info(f'Day {dn} snapshot already recorded for {today} — skipping')
        return

    # Read bot state
    snap = read_bot_snapshot()
    pnl = snap['today_pnl']

    entry = {
        'day':      dn,
        'date':     today,
        'pnl':      round(pnl, 2),
        'wins':     snap['wins'],
        'losses':   snap['losses'],
        'open_pos': len(snap['positions']),
        'mode':     snap['mode'],
    }
    entries.append(entry)
    save_log(entries)

    # Cumulative stats
    total_pnl  = sum(e['pnl'] for e in entries)
    total_wins  = sum(e['wins'] for e in entries)
    total_losses = sum(e['losses'] for e in entries)
    total_closed = total_wins + total_losses
    overall_wr  = total_wins / max(total_closed, 1)
    days_left   = TRIAL_DAYS - dn

    log.info(
        f'Day {dn}/{TRIAL_DAYS} snapshot  |  '
        f'today={"+$" if pnl >= 0 else "-$"}{abs(pnl):.2f}  |  '
        f'total={"+$" if total_pnl >= 0 else "-$"}{abs(total_pnl):.2f}  |  '
        f'win_rate={overall_wr:.0%}'
    )

    # Safety: daily stop-loss
    if pnl <= DAILY_STOP_LOSS:
        log.warning(
            f'DAILY STOP-LOSS triggered (${pnl:.2f} ≤ ${DAILY_STOP_LOSS:.2f}) — '
            f'pausing bot via bot_state.json'
        )
        _pause_bot()
        _send_telegram(
            f'⚠️ *Daily Stop-Loss Hit* — Day {dn}\n'
            f'Today: ${pnl:.2f}  |  Threshold: ${DAILY_STOP_LOSS:.2f}\n'
            f'Bot paused. Resume manually: `/resume`'
        )

    # Safety: monthly stop-loss
    elif total_pnl <= MONTHLY_STOP_LOSS:
        log.warning(
            f'MONTHLY STOP-LOSS triggered (${total_pnl:.2f} ≤ ${MONTHLY_STOP_LOSS:.2f}) — '
            f'pausing bot'
        )
        _pause_bot()
        _send_telegram(
            f'🛑 *Monthly Stop-Loss Hit* — Day {dn}\n'
            f'Total P&L: ${total_pnl:.2f}  |  Threshold: ${MONTHLY_STOP_LOSS:.2f}\n'
            f'Bot paused until you review.'
        )

    else:
        # Normal daily Telegram summary
        sign = '+' if total_pnl >= 0 else ''
        _send_telegram(
            f'📊 *Day {dn}/{TRIAL_DAYS} Summary* — {today}\n'
            f'Today:  {"+$" if pnl >= 0 else ""}{pnl:.2f} USDC\n'
            f'Total:  {sign}{total_pnl:.2f} USDC\n'
            f'W/L:  {total_wins}W / {total_losses}L ({overall_wr:.0%})\n'
            f'Days left: {days_left}'
        )

    # Refresh wallet list every 7 days
    if dn % 7 == 0:
        log.info(f'Day {dn} — weekly wallet refresh')
        _run_wallet_scout()

    # Check if trial is complete
    if dn >= TRIAL_DAYS:
        log.info('Trial complete! Run --report for the full analysis.')
        cmd_report(args)


def cmd_status(args):
    """Print current trial status."""
    state = load_state()
    entries = load_log()

    if not state.get('started_at'):
        print('No active trial. Run --start to begin.')
        return

    dn       = day_number(state)
    days_left = max(0, TRIAL_DAYS - dn)
    total_pnl = sum(e['pnl'] for e in entries)
    wins      = sum(e['wins'] for e in entries)
    losses    = sum(e['losses'] for e in entries)
    total_trades = wins + losses
    wr        = wins / max(total_trades, 1)

    # Current open positions from bot
    snap = read_bot_snapshot()
    open_pos = len(snap['positions'])

    print()
    print('═' * 60)
    print(f'  30-Day Trial — Day {dn}/{TRIAL_DAYS}')
    print('═' * 60)
    print(f'  Start date    : {state["started_at"]}')
    end_dt = date.fromisoformat(state['started_at']) + timedelta(days=TRIAL_DAYS - 1)
    print(f'  End date      : {end_dt.isoformat()}')
    print(f'  Days remaining: {days_left}')
    print()
    print(f'  Total P&L     : {"+$" if total_pnl >= 0 else "-$"}{abs(total_pnl):.2f}')
    print(f'  Win / Loss    : {wins}W / {losses}L ({wr:.0%})')
    print(f'  Open positions: {open_pos}')
    print(f'  Today\'s P&L  : {"+$" if snap["today_pnl"] >= 0 else "-$"}{abs(snap["today_pnl"]):.2f}')
    print()

    if entries:
        best_day  = max(entries, key=lambda e: e['pnl'])
        worst_day = min(entries, key=lambda e: e['pnl'])
        print(f'  Best day      : Day {best_day["day"]} ({best_day["date"]}) +${best_day["pnl"]:.2f}')
        print(f'  Worst day     : Day {worst_day["day"]} ({worst_day["date"]}) ${worst_day["pnl"]:.2f}')
        print()

    # Running P&L table
    if entries:
        print('  Daily P&L log:')
        print(f'  {"Day":>4}  {"Date":<12}  {"P&L":>8}  {"Cum P&L":>9}  {"W":>4}  {"L":>4}')
        print(f'  {"-"*4}  {"-"*12}  {"-"*8}  {"-"*9}  {"-"*4}  {"-"*4}')
        cum = 0.0
        for e in entries:
            cum += e['pnl']
            sign = '+' if e['pnl'] >= 0 else ''
            sign2 = '+' if cum >= 0 else ''
            print(
                f'  {e["day"]:>4}  {e["date"]:<12}  '
                f'{sign}${e["pnl"]:>6.2f}  '
                f'{sign2}${cum:>7.2f}  '
                f'{e["wins"]:>4}  {e["losses"]:>4}'
            )
        print()


def cmd_report(args):
    """Generate full 30-day performance report."""
    state = load_state()
    entries = load_log()

    if not entries:
        print('No trial data yet. Run --day first.')
        return

    total_pnl    = sum(e['pnl'] for e in entries)
    wins         = sum(e['wins'] for e in entries)
    losses       = sum(e['losses'] for e in entries)
    total_trades = wins + losses
    wr           = wins / max(total_trades, 1)
    daily_budget = state.get('daily_budget', DAILY_BUDGET)
    roi          = (total_pnl / (daily_budget * len(entries))) * 100 if entries else 0
    profitable_days = sum(1 for e in entries if e['pnl'] > 0)
    losing_days     = sum(1 for e in entries if e['pnl'] < 0)
    flat_days       = len(entries) - profitable_days - losing_days

    best_day  = max(entries, key=lambda e: e['pnl'])
    worst_day = min(entries, key=lambda e: e['pnl'])

    # Streak analysis
    max_win_streak = cur_streak = 0
    for e in entries:
        if e['pnl'] > 0:
            cur_streak += 1
            max_win_streak = max(max_win_streak, cur_streak)
        else:
            cur_streak = 0

    # Peak drawdown
    peak = 0.0; cum = 0.0; max_dd = 0.0
    for e in entries:
        cum += e['pnl']
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd

    print()
    print('╔' + '═' * 58 + '╗')
    print('║  30-DAY COPY-TRADE TRIAL — FINAL REPORT' + ' ' * 17 + '║')
    print('╠' + '═' * 58 + '╣')
    print(f'║  Period:  {state.get("started_at", "?")} → {entries[-1]["date"]:<28}║')
    print(f'║  Days completed: {len(entries):<40}║')
    print('╠' + '═' * 58 + '╣')
    sign = '+' if total_pnl >= 0 else ''
    print(f'║  Total P&L:       {sign}${abs(total_pnl):<36.2f}║')
    print(f'║  ROI on capital:  {roi:+.1f}%{" " * 36}║')
    print(f'║  Win rate:        {wr:.0%}{" " * 37}║')
    print(f'║  Trades:          {total_trades} ({wins}W / {losses}L){" " * 26}║')
    print('╠' + '═' * 58 + '╣')
    print(f'║  Profitable days: {profitable_days}{" " * 39}║')
    print(f'║  Losing days:     {losing_days}{" " * 39}║')
    print(f'║  Flat days:       {flat_days}{" " * 39}║')
    print(f'║  Best day:        Day {best_day["day"]} ({best_day["date"]}) +${best_day["pnl"]:.2f}{" " * 14}║')
    print(f'║  Worst day:       Day {worst_day["day"]} ({worst_day["date"]}) ${worst_day["pnl"]:.2f}{" " * 15}║')
    print(f'║  Max win streak:  {max_win_streak} days{" " * 34}║')
    print(f'║  Max drawdown:    -${max_dd:.2f}{" " * 35}║')
    print('╠' + '═' * 58 + '╣')

    # Verdict
    if total_pnl > 0 and wr >= 0.55:
        verdict = '✅  PASSED — profitable with good win rate'
        action  = 'Recommended: go live with $100–200 budget, same wallet list'
    elif total_pnl > 0:
        verdict = '⚠️  MARGINALLY PASSED — profitable but low win rate'
        action  = 'Recommended: re-scout wallets, raise MIN_COPY_WALLETS to 3'
    elif total_pnl > -20:
        verdict = '❌  BORDERLINE — small loss, strategy needs tuning'
        action  = 'Recommended: run another trial with stricter filters'
    else:
        verdict = '❌  FAILED — too much loss for this period'
        action  = 'Recommended: pause and re-scout wallets in a different time window'

    print(f'║  Result:  {verdict:<48}║')
    print(f'║  Action:  {action[:48]:<48}║')
    print('╚' + '═' * 58 + '╝')
    print()

    if total_pnl > 0:
        projected_monthly = total_pnl * (30 / max(len(entries), 1))
        print(f'  Monthly projected (if live at 5× capital): +${projected_monthly * 5:.0f}')
        print()

    # Send report to Telegram
    sign = '+' if total_pnl >= 0 else ''
    _send_telegram(
        f'📋 *30-Day Trial Report*\n'
        f'Period: {state.get("started_at")} → {entries[-1]["date"]}\n'
        f'Total P&L: {sign}${abs(total_pnl):.2f} ({roi:+.1f}% ROI)\n'
        f'Win rate: {wr:.0%} ({wins}W / {losses}L)\n'
        f'Max drawdown: -${max_dd:.2f}\n'
        f'{verdict}'
    )


def _pause_bot():
    """Write paused=true to bot_state.json."""
    s = _read_json(BOT_STATE, {})
    s['paused'] = True
    _write_json(BOT_STATE, s)


# ─────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='30-Day Copy-Trade Trial Manager')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--start',  action='store_true', help='Start a new 30-day trial')
    group.add_argument('--day',    action='store_true', help='Record today\'s snapshot (run via cron)')
    group.add_argument('--status', action='store_true', help='Show trial progress')
    group.add_argument('--report', action='store_true', help='Print final report')
    args = parser.parse_args()

    os.makedirs('data', exist_ok=True)

    if args.start:
        cmd_start(args)
    elif args.day:
        cmd_day(args)
    elif args.status:
        cmd_status(args)
    elif args.report:
        cmd_report(args)


if __name__ == '__main__':
    main()
