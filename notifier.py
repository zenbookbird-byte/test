#!/usr/bin/env python3
"""
notifier.py — Telegram push notifications + shared state for CopyTrade Pro
===========================================================================
Imported by copy_trader.py. Handles two responsibilities:

  1. Push messages to your Telegram chat when the bot acts.
  2. Write/read bot_state.json so telegram_bot.py can answer commands.

Requires in .env:
  TELEGRAM_BOT_TOKEN=<token from @BotFather>
  TELEGRAM_CHAT_ID=<your chat id — run telegram_bot.py --get-chat-id>

If those vars are not set, all calls are silently no-ops — the main bot
keeps running normally.
"""

import os, json, requests, random, string
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

TOKEN      = os.getenv('TELEGRAM_BOT_TOKEN', '')
CHAT_ID    = os.getenv('TELEGRAM_CHAT_ID', '')
STATE_FILE = os.getenv('BOT_STATE_FILE', 'bot_state.json')
_API       = f'https://api.telegram.org/bot{TOKEN}'

# ── in-memory state (mirrored to disk) ───────────────────────────────────────
_state: dict = {
    'running':     True,
    'paper':       True,
    'mode':        'war',
    'budget':      0.0,
    'paused':      False,
    'started_at':  '',
    'positions':   {},      # market_id → {title, price, size, tokens, opened_at}
    'today_pnl':   0.0,
    'wins':        0,
    'losses':      0,
    'all_wins':    0,       # all-time (persists across restarts via state file)
    'all_losses':  0,
    'last_trades': [],      # last 20 closed trades
    'poll_count':  0,       # total subgraph polls this session
    'last_poll':   '',      # ISO timestamp of last poll
    # ── analytics ─────────────────────────────────────────────────────────────
    'pnl_history':   [],   # [{id, ts, pnl, title}] last 300 — equity curve
    'daily_pnl':     {},   # {'2024-01-15': 1.23} — P&L calendar
    'recent_events': [],   # [{id, type, title, pnl?, size?, at}] last 50 — toasts
    'signals':       {},   # {market_id: {title, votes, threshold, updated_at}}
}


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────
def _flush() -> None:
    """Write current state to disk so telegram_bot.py can read it."""
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(_state, f, indent=2)
    except Exception:
        pass   # never crash the bot over a file write


def _uid() -> str:
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _add_event(ev: dict) -> None:
    ev.setdefault('id', 'ev-' + _uid())
    ev.setdefault('at', _now_iso())
    _state['recent_events'].insert(0, ev)
    _state['recent_events'] = _state['recent_events'][:50]


def _send(text: str) -> None:
    """Send a Telegram message. Silent no-op if credentials are missing."""
    if not TOKEN or not CHAT_ID:
        return
    try:
        requests.post(
            f'{_API}/sendMessage',
            json={'chat_id': CHAT_ID, 'text': text, 'parse_mode': 'HTML'},
            timeout=6,
        )
    except Exception:
        pass   # never block the main loop on a network hiccup


# ─────────────────────────────────────────────────────────────────────────────
#  Public state API  (called by copy_trader.py)
# ─────────────────────────────────────────────────────────────────────────────
def init(paper: bool, mode: str, budget: float) -> None:
    """Call once at bot startup. Preserves all-time counters from previous run."""
    # Read existing state to carry forward all-time counters
    prev_all_wins = prev_all_losses = 0
    try:
        with open(STATE_FILE) as f:
            prev = json.load(f)
            prev_all_wins   = int(prev.get('all_wins',  0))
            prev_all_losses = int(prev.get('all_losses', 0))
    except Exception:
        pass

    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    # Preserve cross-session analytics from previous run
    try:
        with open(STATE_FILE) as f:
            prev = json.load(f)
            prev_history    = prev.get('pnl_history', [])
            prev_daily      = prev.get('daily_pnl', {})
            # Carry forward only history from previous days (today resets)
            prev_daily.pop(today, None)
    except Exception:
        prev_history = []
        prev_daily   = {}

    _state.update({
        'paper':         paper,
        'mode':          mode,
        'budget':        budget,
        'started_at':    _now_iso(),
        'paused':        False,
        'positions':     {},
        'today_pnl':     0.0,
        'wins':          0,
        'losses':        0,
        'all_wins':      prev_all_wins,
        'all_losses':    prev_all_losses,
        'last_trades':   [],
        'poll_count':    0,
        'last_poll':     '',
        'pnl_history':   prev_history,
        'daily_pnl':     prev_daily,
        'recent_events': [],
        'signals':       {},
    })
    _flush()


def record_poll() -> None:
    """Call each subgraph poll cycle so the dashboard can show activity."""
    _state['poll_count'] = _state.get('poll_count', 0) + 1
    _state['last_poll']  = datetime.utcnow().isoformat()
    _flush()


def is_paused() -> bool:
    """
    Return True if telegram_bot.py set the pause flag.
    Re-reads the file so the flag is picked up without restarting.
    """
    try:
        with open(STATE_FILE) as f:
            return json.load(f).get('paused', False)
    except Exception:
        return False


def record_buy(market_id: str, title: str, price: float,
               size: float, tokens: float) -> None:
    _state['positions'][market_id] = {
        'title':         title,
        'price':         price,
        'size':          size,
        'tokens':        tokens,
        'current_price': price,   # updated by record_price_update()
        'opened_at':     _now_iso(),
    }
    _add_event({'type': 'buy', 'title': title[:60], 'size': round(size, 2), 'price': price})
    _flush()


def record_sell(market_id: str, pnl: float) -> None:
    pos   = _state['positions'].pop(market_id, {})
    title = pos.get('title', market_id[:40])
    pnl   = round(pnl, 2)
    if pnl >= 0:
        _state['wins']      += 1
        _state['all_wins']  += 1
    else:
        _state['losses']     += 1
        _state['all_losses'] += 1
    _state['today_pnl'] = round(_state['today_pnl'] + pnl, 2)

    # Last-trades feed
    _state['last_trades'].insert(0, {
        'id':    'tr-' + _uid(),
        'title': title,
        'pnl':   pnl,
        'cost':  round(pos.get('size', 0), 2),
        'at':    _now_iso(),
    })
    _state['last_trades'] = _state['last_trades'][:20]

    # Equity curve — append point (newest first, JS reverses for display)
    _state['pnl_history'].insert(0, {
        'id':    'ph-' + _uid(),
        'ts':    _now_iso(),
        'pnl':   pnl,
        'title': title[:60],
    })
    _state['pnl_history'] = _state['pnl_history'][:300]

    # P&L calendar
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    _state['daily_pnl'][today] = round(
        _state['daily_pnl'].get(today, 0.0) + pnl, 2)

    # Event for toast/sound/notification
    _add_event({'type': 'win' if pnl >= 0 else 'loss',
                'title': title[:60], 'pnl': pnl})
    _flush()


def record_signal(market_id: str, title: str, votes: int, threshold: int) -> None:
    """Record current vote count for a market — used for consensus meter."""
    _state['signals'][market_id] = {
        'title':      title[:80],
        'votes':      votes,
        'threshold':  threshold,
        'updated_at': _now_iso(),
    }
    if votes >= threshold:
        _add_event({'type': 'signal', 'title': title[:60],
                    'votes': votes, 'threshold': threshold})
    _flush()


def record_price_update(market_id: str, current_price: float) -> None:
    """Update live price on an open position — enables unrealized P&L display."""
    if market_id in _state['positions']:
        _state['positions'][market_id]['current_price'] = round(current_price, 4)
        # flush() is deliberately omitted here — called in bulk by poll cycle


def set_running(value: bool) -> None:
    _state['running'] = value
    _flush()


# ─────────────────────────────────────────────────────────────────────────────
#  Telegram notifications  (called by copy_trader.py at key events)
# ─────────────────────────────────────────────────────────────────────────────
def notify_start(paper: bool, mode: str, budget: float) -> None:
    icons = {'war': '⚔️', 'btc': '₿', 'eth': 'Ξ', 'sol': '◎'}
    m_icon = icons.get(mode, '🤖')
    status = '📋 PAPER MODE' if paper else '⚡ LIVE TRADING'
    _send(
        f"{m_icon} <b>CopyTrade Pro started</b>\n"
        f"Status: <b>{status}</b>\n"
        f"Market: <b>{mode.upper()}</b>  |  Budget: <b>${budget} USDC</b>\n"
        f"Send /status to check in anytime."
    )


def notify_signal(market: str, wallet_count: int, price: float, size: float) -> None:
    _send(
        f"🔔 <b>Signal detected</b>\n"
        f"<i>{market[:70]}</i>\n\n"
        f"Wallets in agreement: <b>{wallet_count}</b>\n"
        f"YES price: <b>${price:.3f}</b>  ({price*100:.0f}¢)\n"
        f"Sizing: <b>${size:.2f} USDC</b>"
    )


def notify_buy(market: str, price: float, size: float, paper: bool) -> None:
    prefix = '📋 PAPER ' if paper else '✅ '
    _send(
        f"{prefix}<b>BUY executed</b>\n"
        f"<i>{market[:70]}</i>\n\n"
        f"YES @ <b>${price:.3f}</b>  |  <b>${size:.2f} USDC</b>"
    )


def notify_sell(market: str, cost: float, pnl: float, paper: bool) -> None:
    if pnl >= 0:
        icon = '📋 PAPER ' if paper else '🟢 '
        pct  = round(pnl / cost * 100) if cost else 0
        detail = f"P&amp;L: <b>+${pnl:.2f}  (+{pct}%)</b>"
    else:
        icon = '📋 PAPER ' if paper else '🔴 '
        pct  = round(abs(pnl) / cost * 100) if cost else 0
        detail = f"P&amp;L: <b>-${abs(pnl):.2f}  (-{pct}%)</b>"
    _send(
        f"{icon}<b>Position closed</b>\n"
        f"<i>{market[:70]}</i>\n\n"
        f"Cost: ${cost:.2f}  |  {detail}"
    )


def notify_error(msg: str) -> None:
    _send(f"⚠️ <b>Bot error</b>\n<code>{str(msg)[:300]}</code>")


def notify_paused() -> None:
    _send("⏸ Bot <b>paused</b> via Telegram. Existing positions held.")


def notify_resumed() -> None:
    _send("▶️ Bot <b>resumed</b>. Back to scanning for signals.")
