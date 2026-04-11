#!/usr/bin/env bash
# Tankkollen local launcher (macOS / Linux)
# --------------------------------------------------------
# Double-clicking index.html or dator.html does NOT work
# because modern browsers block some file:// operations
# (fetching live_prices.json, service workers, etc.).
#
# Run this script instead — it spins up a tiny local
# web server and opens the app in your default browser.

set -e

# Make sure we're in the tankkollen directory (the script's own folder)
cd "$(dirname "$0")"
cd ..  # up one level so we serve from the repo root

PORT="${TANKKOLLEN_PORT:-8765}"
URL="http://localhost:${PORT}/tankkollen/index.html"

echo "============================================"
echo " Tankkollen local server"
echo "  → ${URL}"
echo "  → Pro Dashboard: http://localhost:${PORT}/tankkollen/dator.html"
echo ""
echo " Press Ctrl+C to stop."
echo "============================================"

# Pick an available Python
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Error: python3 is not installed."
  echo "Install it from https://www.python.org/downloads/ and try again."
  exit 1
fi

# Open the browser after a short delay (server is already listening by then)
(
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "${URL}" || true
  fi
) &

exec "${PY}" -m http.server "${PORT}"
