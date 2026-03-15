#!/usr/bin/env python3
"""
server.py — Lightweight state API for CopyTrade Pro
=====================================================
Serves bot_state.json at GET /state so the frontend can poll live data.

Usage:
  python server.py                   # default port 8080
  python server.py --port 3001       # custom port

Runs alongside copy_trader.py. Both processes share bot_state.json.

Dependencies:  none beyond stdlib (uses http.server + json)
Optional:      pip install flask  → enables flask mode with nicer logging
"""

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_FILE = os.getenv('BOT_STATE_FILE', 'bot_state.json')

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
}


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {'error': 'bot_state.json not found — is copy_trader.py running?'}
    except json.JSONDecodeError:
        return {'error': 'bot_state.json is malformed'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress per-request logs; show only errors
        pass

    def _send(self, code: int, body: str, content_type: str = 'application/json'):
        encoded = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(encoded)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        # Pre-flight CORS
        self._send(204, '')

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/state':
            data = _load_state()
            self._send(200, json.dumps(data))

        elif path == '/health':
            self._send(200, json.dumps({'ok': True}))

        else:
            self._send(404, json.dumps({'error': 'Not found'}))


def main():
    parser = argparse.ArgumentParser(description='CopyTrade Pro state API')
    parser.add_argument('--port', type=int, default=8080,
                        help='Port to listen on (default: 8080)')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Host to bind to (default: 0.0.0.0)')
    args = parser.parse_args()

    print(f'CopyTrade Pro state server listening on http://{args.host}:{args.port}')
    print(f'  GET /state  → live bot data from {STATE_FILE}')
    print(f'  GET /health → health check')
    print()

    server = HTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')


if __name__ == '__main__':
    main()
