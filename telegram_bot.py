#!/usr/bin/env python3
"""
telegram_bot.py — Telegram Control Bot for CopyTrade Pro
=========================================================
Runs alongside copy_trader.py as a separate process.
Reads/writes bot_state.json to communicate with the main bot.

COMMANDS
--------
  /start      Welcome + quick status
  /status     Bot health, mode, paper/live
  /pnl        Today's P&L, win rate, trade count
  /positions  Open positions with entry price + size
  /trades     Last 10 closed trades
  /pause      Stop new entries (existing positions kept)
  /resume     Restart scanning for signals
  /help       Full command list

SETUP (one-time)
----------------
  1. Message @BotFather on Telegram:
       /newbot
     Follow the prompts — it gives you a TOKEN.

  2. Find your chat ID:
       python telegram_bot.py --get-chat-id
     Then message your new bot anything. It prints your TELEGRAM_CHAT_ID.

  3. Add to .env:
       TELEGRAM_BOT_TOKEN=123456:ABC...
       TELEGRAM_CHAT_ID=987654321

  4. Run in background:
       nohup python telegram_bot.py &   # on VPS
       # or inside tmux:  tmux new -s tgbot

RUN ALONGSIDE COPY TRADER
--------------------------
  Terminal 1:  python copy_trader.py
  Terminal 2:  python telegram_bot.py

  Both share bot_state.json automatically.
"""

import os, sys, json, time, requests
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

TOKEN      = os.getenv('TELEGRAM_BOT_TOKEN', '')
CHAT_ID    = str(os.getenv('TELEGRAM_CHAT_ID', ''))
STATE_FILE = os.getenv('BOT_STATE_FILE', 'bot_state.json')
_API       = f'https://api.telegram.org/bot{TOKEN}'
POLL_TIMEOUT = 30   # seconds for long-polling

if not TOKEN:
    print('ERROR: TELEGRAM_BOT_TOKEN is not set.\n'
          'Add it to your .env file.\n'
          'Get one free from @BotFather on Telegram.')
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
#  API helpers
# ─────────────────────────────────────────────────────────────────────────────
def _api(method: str, **kwargs) -> dict:
    try:
        r = requests.post(f'{_API}/{method}', json=kwargs, timeout=POLL_TIMEOUT + 5)
        return r.json()
    except Exception as e:
        print(f'[api error] {method}: {e}')
        return {}


def send(text: str, chat_id: str = CHAT_ID, **kwargs) -> None:
    _api('sendMessage', chat_id=chat_id, text=text, parse_mode='HTML', **kwargs)


def get_updates(offset: int) -> list:
    res = _api('getUpdates', offset=offset, timeout=POLL_TIMEOUT)
    return res.get('result', [])


# ─────────────────────────────────────────────────────────────────────────────
#  State helpers
# ─────────────────────────────────────────────────────────────────────────────
def read_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f'[state] read error: {e}')
        return {}


def write_state(updates: dict) -> None:
    s = read_state()
    s.update(updates)
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(s, f, indent=2)
    except Exception as e:
        print(f'[state] write error: {e}')


def _pnl_sign(pnl: float) -> str:
    return '+' if pnl >= 0 else ''


def _time_since(iso: str) -> str:
    """Return human-readable time since an ISO timestamp."""
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        diff = (datetime.now(timezone.utc) - dt).total_seconds()
        if diff < 60:
            return f'{int(diff)}s ago'
        if diff < 3600:
            return f'{int(diff/60)}m ago'
        if diff < 86400:
            return f'{int(diff/3600)}h ago'
        return f'{int(diff/86400)}d ago'
    except Exception:
        return iso[:16]


# ─────────────────────────────────────────────────────────────────────────────
#  Command handlers
# ─────────────────────────────────────────────────────────────────────────────
def cmd_start(chat_id: str) -> None:
    s = read_state()
    if s:
        status = '⏸ PAUSED' if s.get('paused') else ('📋 PAPER' if s.get('paper') else '⚡ LIVE')
        extra  = f'\n\nBot is currently <b>{status}</b>. Use /status for details.'
    else:
        extra  = '\n\n⚠️ Bot state file not found — is copy_trader.py running?'
    send(
        '🤖 <b>CopyTrade Pro — Telegram Control</b>\n'
        'I alert you on every signal, trade, and close in real time.'
        f'{extra}\n\n'
        'Commands:\n'
        '/status — health check\n'
        '/pnl — today\'s P&L\n'
        '/positions — open positions\n'
        '/trades — recent history\n'
        '/pause · /resume — control the bot',
        chat_id=chat_id,
    )


def cmd_status(chat_id: str) -> None:
    s = read_state()
    if not s:
        send(
            '⚠️ <b>State file not found</b>\n\n'
            'The main bot hasn\'t written any state yet.\n'
            'Make sure copy_trader.py is running and has completed at least one cycle.',
            chat_id=chat_id,
        )
        return

    mode     = s.get('mode', 'war').upper()
    paper    = s.get('paper', True)
    budget   = s.get('budget', 0)
    paused   = s.get('paused', False)
    n_pos    = len(s.get('positions', {}))
    wins     = s.get('wins', 0)
    losses   = s.get('losses', 0)
    total    = wins + losses
    wr       = f'{round(wins/total*100)}%' if total else '—'
    started  = _time_since(s.get('started_at', ''))

    state_str = '⏸ PAUSED' if paused else '▶️ Running'
    trade_str = '📋 Paper' if paper else '⚡ Live'

    send(
        f'📊 <b>Bot Status</b>\n\n'
        f'State:     <b>{state_str}</b>\n'
        f'Trading:   <b>{trade_str}</b>  ({mode} mode)\n'
        f'Budget:    <b>${budget} USDC</b>\n'
        f'Open pos:  <b>{n_pos}</b>\n'
        f'Win rate:  <b>{wr}</b>  ({wins}W / {losses}L)\n'
        f'Uptime:    {started}',
        chat_id=chat_id,
    )


def cmd_pnl(chat_id: str) -> None:
    s    = read_state()
    pnl  = s.get('today_pnl', 0.0)
    wins = s.get('wins', 0)
    loss = s.get('losses', 0)
    total = wins + loss
    wr   = f'{round(wins/total*100)}%' if total else '—'
    sign = _pnl_sign(pnl)
    icon = '🟢' if pnl >= 0 else '🔴'

    # compute average win/loss from last_trades
    trades = s.get('last_trades', [])
    w_vals = [t['pnl'] for t in trades if t.get('pnl', 0) >= 0]
    l_vals = [t['pnl'] for t in trades if t.get('pnl', 0) < 0]
    avg_w  = f'${sum(w_vals)/len(w_vals):.2f}' if w_vals else '—'
    avg_l  = f'${abs(sum(l_vals)/len(l_vals)):.2f}' if l_vals else '—'

    send(
        f'{icon} <b>Today\'s P&amp;L</b>\n\n'
        f'Net P&amp;L:   <b>{sign}${abs(pnl):.2f}</b>\n'
        f'Trades:    {total}  ({wins}W / {loss}L)\n'
        f'Win rate:  <b>{wr}</b>\n'
        f'Avg win:   {avg_w}  |  Avg loss: {avg_l}',
        chat_id=chat_id,
    )


def cmd_positions(chat_id: str) -> None:
    s         = read_state()
    positions = s.get('positions', {})
    if not positions:
        send('📭 No open positions right now.', chat_id=chat_id)
        return

    lines = [f'📊 <b>Open positions ({len(positions)})</b>\n']
    for mid, p in list(positions.items())[:8]:
        title   = p.get('title', mid[:30])[:50]
        entry   = p.get('price', 0)
        size    = p.get('size', 0)
        tokens  = p.get('tokens', 0)
        opened  = _time_since(p.get('opened_at', ''))
        lines.append(
            f'• <b>{title}</b>\n'
            f'  Entry: ${entry:.3f}  |  ${size:.2f}  |  {tokens:.1f} tokens\n'
            f'  Opened: {opened}'
        )
    send('\n\n'.join(lines), chat_id=chat_id)


def cmd_trades(chat_id: str) -> None:
    s      = read_state()
    trades = s.get('last_trades', [])
    if not trades:
        send('📭 No closed trades yet.', chat_id=chat_id)
        return

    lines = [f'📋 <b>Recent trades ({len(trades)})</b>\n']
    for t in trades[:8]:
        pnl   = t.get('pnl', 0)
        sign  = _pnl_sign(pnl)
        icon  = '🟢' if pnl >= 0 else '🔴'
        title = t.get('title', '?')[:50]
        when  = _time_since(t.get('at', ''))
        lines.append(f'{icon} {title}\n  <b>{sign}${abs(pnl):.2f}</b>  ·  {when}')

    send('\n\n'.join(lines), chat_id=chat_id)


def cmd_pause(chat_id: str) -> None:
    write_state({'paused': True})
    send(
        '⏸ <b>Bot paused</b>\n\n'
        'No new positions will be opened.\n'
        'Existing positions are held and monitored.\n\n'
        'Use /resume to restart.',
        chat_id=chat_id,
    )


def cmd_resume(chat_id: str) -> None:
    write_state({'paused': False})
    send(
        '▶️ <b>Bot resumed</b>\n\n'
        'Back to scanning for signals.',
        chat_id=chat_id,
    )


def cmd_help(chat_id: str) -> None:
    send(
        '📖 <b>All Commands</b>\n\n'
        '/start — welcome + quick status\n'
        '/status — health check (mode, paper/live, uptime)\n'
        '/pnl — today\'s P&amp;L + win rate\n'
        '/positions — open positions with entry price\n'
        '/trades — last 10 closed trades\n'
        '/pause — stop new entries (keep existing positions)\n'
        '/resume — restart scanning for signals\n'
        '/help — this message\n\n'
        '<i>Notifications arrive automatically on every signal, '
        'trade open, and close.</i>',
        chat_id=chat_id,
    )


COMMANDS: dict = {
    '/start':     cmd_start,
    '/status':    cmd_status,
    '/pnl':       cmd_pnl,
    '/positions': cmd_positions,
    '/trades':    cmd_trades,
    '/pause':     cmd_pause,
    '/resume':    cmd_resume,
    '/help':      cmd_help,
}


# ─────────────────────────────────────────────────────────────────────────────
#  Chat ID discovery helper
# ─────────────────────────────────────────────────────────────────────────────
def get_chat_id() -> None:
    print('Open Telegram, find your new bot, and send it any message.')
    print('Waiting...\n')
    offset = 0
    while True:
        updates = get_updates(offset)
        for upd in updates:
            offset = upd['update_id'] + 1
            msg    = upd.get('message', {})
            cid    = msg.get('chat', {}).get('id')
            name   = msg.get('chat', {}).get('first_name', '')
            text   = msg.get('text', '')
            if cid:
                print(f'✅ Found it!\n')
                print(f'   Name:    {name}')
                print(f'   Chat ID: {cid}')
                print(f'   Message: "{text}"\n')
                print('Add this to your .env file:')
                print(f'   TELEGRAM_CHAT_ID={cid}')
                return
        time.sleep(1)


# ─────────────────────────────────────────────────────────────────────────────
#  Main long-polling loop
# ─────────────────────────────────────────────────────────────────────────────
def run() -> None:
    # Verify the token works
    me = _api('getMe')
    if not me.get('ok'):
        print('ERROR: Could not connect to Telegram. Check your TELEGRAM_BOT_TOKEN.')
        sys.exit(1)
    bot_name = me['result'].get('username', 'bot')
    print(f'Connected as @{bot_name}')

    if CHAT_ID:
        send(
            f'🤖 <b>CopyTrade Pro bot connected.</b>\n'
            f'Type /help for all commands.\n'
            f'You\'ll receive alerts automatically when the bot acts.'
        )
        print(f'Sending alerts to chat ID {CHAT_ID}')
    else:
        print('WARNING: TELEGRAM_CHAT_ID not set — commands will work but alerts won\'t be sent.')

    print('Polling for commands... (Ctrl+C to stop)\n')
    offset = 0
    while True:
        try:
            updates = get_updates(offset)
            for upd in updates:
                offset = upd['update_id'] + 1
                msg    = upd.get('message', {})
                if not msg:
                    continue
                chat_id  = str(msg.get('chat', {}).get('id', ''))
                text     = msg.get('text', '').strip()

                # Security: only respond to the configured owner chat
                if CHAT_ID and chat_id != CHAT_ID:
                    send('⛔ Unauthorized.', chat_id=chat_id)
                    print(f'Rejected message from unknown chat {chat_id}')
                    continue

                # Strip bot username suffix (@mybot) from command
                cmd = text.split('@')[0].lower()
                handler = COMMANDS.get(cmd)
                if handler:
                    print(f'Command: {cmd}  from {chat_id}')
                    handler(chat_id)
                elif text.startswith('/'):
                    send(
                        f'Unknown command: <code>{text[:30]}</code>\n'
                        'Type /help for the list.',
                        chat_id=chat_id,
                    )

        except KeyboardInterrupt:
            print('\nStopped.')
            break
        except Exception as e:
            print(f'[poll error] {e}')
            time.sleep(5)


# ─────────────────────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if '--help' in sys.argv or '-h' in sys.argv:
        print(__doc__)
        sys.exit(0)

    if '--get-chat-id' in sys.argv:
        get_chat_id()
    else:
        run()
