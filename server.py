#!/usr/bin/env python3
"""
server.py — Lightweight state API for CopyTrade Pro
=====================================================
Serves bot_state.json at GET /state so the frontend can poll live data.
Also exposes POST /agent — a streaming SSE endpoint backed by Claude Opus 4.6
that acts as an AI Analyst with live access to the bot state.

Usage:
  python server.py                   # default port 8080
  python server.py --port 3001       # custom port

Requires for AI Analyst:
  pip install anthropic
  ANTHROPIC_API_KEY=<key>  in your .env file

Runs alongside copy_trader.py. Both processes share bot_state.json.
"""

import argparse
import json
import os
import socketserver
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Optional anthropic SDK ────────────────────────────────────────────────────
try:
    import anthropic as _anthropic
    _AI_AVAILABLE = True
except ImportError:
    _AI_AVAILABLE = False
    _anthropic = None  # type: ignore

STATE_FILE = os.getenv('BOT_STATE_FILE', 'bot_state.json')
AI_MODEL   = 'claude-opus-4-6'

CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control':                'no-cache, no-store, must-revalidate',
}


# ── Threaded server so SSE requests don't block /state polls ──────────────────
class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


# ── Helpers ───────────────────────────────────────────────────────────────────
def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {'error': 'bot_state.json not found — is copy_trader.py running?'}
    except json.JSONDecodeError:
        return {'error': 'bot_state.json is malformed'}


def _build_system(state: dict) -> str:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    wins   = state.get('all_wins',   state.get('wins',   0))
    losses = state.get('all_losses', state.get('losses', 0))
    total  = wins + losses
    wr     = f'{wins/total*100:.1f}%' if total else 'N/A'
    budget = state.get('budget', 50)
    spent  = sum(p.get('size', 0) for p in state.get('positions', {}).values())
    avail  = max(0, budget - spent)

    # Compact state summary so we don't waste tokens on raw JSON
    summary = {
        'mode':         state.get('mode', '?'),
        'paper':        state.get('paper', True),
        'paused':       state.get('paused', False),
        'running':      state.get('running', True),
        'budget':       f'${budget}',
        'available':    f'${avail:.2f}',
        'today_pnl':    f'${state.get("today_pnl", 0):.2f}',
        'today_wl':     f'{state.get("wins",0)}W / {state.get("losses",0)}L',
        'all_time_wl':  f'{wins}W / {losses}L',
        'win_rate':     wr,
        'open_positions': {
            mid: {
                'title': p.get('title', mid[:40]),
                'size':  f'${p.get("size", 0):.2f}',
                'price': p.get('price', 0),
                'since': p.get('opened_at', '?')[:16],
            }
            for mid, p in state.get('positions', {}).items()
        },
        'recent_trades': [
            {
                'title': t.get('title', '?')[:60],
                'pnl':   f'${t.get("pnl", 0):+.2f}',
                'at':    t.get('at', '?')[:16],
            }
            for t in state.get('last_trades', [])[:8]
        ],
        'poll_count': state.get('poll_count', 0),
        'last_poll':  state.get('last_poll', '?')[:16],
        'started_at': state.get('started_at', '?')[:16],
    }

    return f"""You are the AI Analyst embedded in CopyTrade Pro, a Polymarket copy trading bot dashboard.

Current bot state (live snapshot as of {now}):
{json.dumps(summary, indent=2)}

Your role:
- Analyse bot performance using the exact numbers above
- Explain open positions, recent trades, win/loss trends
- Give concise, actionable advice on risk, sizing, or timing
- Interpret Polymarket copy trading signals and market context
- Answer any operational question about the bot

Rules:
- Be direct and concise — 2-5 sentences unless detailed analysis is asked for
- Always cite specific numbers when they're relevant (win rate, P&L, sizes)
- If the bot is offline (state has an 'error' key), say so and suggest running copy_trader.py
- If paused, acknowledge it and answer accordingly
- Never invent data not present in the state
- Use plain trading language; no excessive jargon"""


# ── Request handler ───────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass   # suppress noisy per-request logs

    def _send(self, code: int, body: str, content_type: str = 'application/json'):
        encoded = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(encoded)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(encoded)

    def _send_err_event(self, msg: str):
        """Write a single SSE error event (used inside streaming handlers)."""
        try:
            data = json.dumps({'error': msg})
            self.wfile.write(f'data: {data}\n\ndata: {{"done":true}}\n\n'.encode())
            self.wfile.flush()
        except Exception:
            pass

    def do_OPTIONS(self):
        self._send(204, '')

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/state':
            self._send(200, json.dumps(_load_state()))
        elif path == '/health':
            self._send(200, json.dumps({
                'ok': True,
                'ai_available': _AI_AVAILABLE,
                'api_key_set':  bool(os.getenv('ANTHROPIC_API_KEY')),
            }))
        else:
            self._send(404, json.dumps({'error': 'Not found'}))

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/agent':
            self._handle_agent()
        else:
            self._send(404, json.dumps({'error': 'Not found'}))

    # ── /agent — SSE streaming chat ──────────────────────────────────────────
    def _handle_agent(self):
        # Guard: SDK installed?
        if not _AI_AVAILABLE:
            self._send(503, json.dumps({
                'error': 'anthropic package not installed — run: pip install anthropic'
            }))
            return

        # Guard: API key present?
        api_key = os.getenv('ANTHROPIC_API_KEY', '')
        if not api_key:
            self._send(503, json.dumps({
                'error': 'ANTHROPIC_API_KEY is not set — add it to your .env file'
            }))
            return

        # Parse request body
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
        except Exception:
            self._send(400, json.dumps({'error': 'Invalid JSON body'}))
            return

        message = (body.get('message') or '').strip()
        if not message:
            self._send(400, json.dumps({'error': '"message" field is required'}))
            return

        history = body.get('history', [])   # [{role, content}, …]

        # Build messages list (last 12 turns for context)
        messages = []
        for h in history[-12:]:
            role    = h.get('role', '')
            content = h.get('content', '')
            if role in ('user', 'assistant') and content:
                messages.append({'role': role, 'content': content})
        messages.append({'role': 'user', 'content': message})

        # Start SSE response
        self.send_response(200)
        self.send_header('Content-Type',  'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection',    'keep-alive')
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()

        # Stream Claude response
        client = _anthropic.Anthropic(api_key=api_key)
        state  = _load_state()
        system = _build_system(state)

        try:
            with client.messages.stream(
                model=AI_MODEL,
                max_tokens=1024,
                thinking={'type': 'adaptive'},
                system=system,
                messages=messages,
            ) as stream:
                for text_chunk in stream.text_stream:
                    data = json.dumps({'text': text_chunk})
                    self.wfile.write(f'data: {data}\n\n'.encode())
                    self.wfile.flush()

        except _anthropic.AuthenticationError:
            self._send_err_event('Invalid ANTHROPIC_API_KEY — check your .env file')
            return
        except _anthropic.RateLimitError:
            self._send_err_event('Anthropic rate limit hit — try again in a moment')
            return
        except _anthropic.APIStatusError as e:
            self._send_err_event(f'API error {e.status_code}: {e.message}')
            return
        except BrokenPipeError:
            return   # client disconnected — normal
        except Exception as e:
            self._send_err_event(str(e)[:200])
            return

        # Send done sentinel
        try:
            self.wfile.write(b'data: {"done":true}\n\n')
            self.wfile.flush()
        except BrokenPipeError:
            pass


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='CopyTrade Pro state + AI API')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()

    ai_status = (
        f'✓ claude-{AI_MODEL} ready'
        if _AI_AVAILABLE and os.getenv('ANTHROPIC_API_KEY')
        else '✗ AI offline (set ANTHROPIC_API_KEY + pip install anthropic)'
    )

    print(f'CopyTrade Pro API  →  http://{args.host}:{args.port}')
    print(f'  GET  /state   →  live bot data from {STATE_FILE}')
    print(f'  POST /agent   →  SSE streaming AI analyst  [{ai_status}]')
    print(f'  GET  /health  →  health check')
    print()

    server = ThreadedHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')


if __name__ == '__main__':
    main()
