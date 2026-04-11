"""Shared HTTP helper used by all data sources."""

from __future__ import annotations

import sys
import urllib.error
import urllib.request
from typing import Optional

USER_AGENT = (
    "Mozilla/5.0 (compatible; Tankkollen/1.0; "
    "+https://github.com/zenbookbird-byte/test)"
)


def http_get(url: str, timeout: int = 20, accept: str = "text/html,application/xhtml+xml,application/json;q=0.9") -> Optional[str]:
    """Fetches a URL and returns the body as text. Returns None on any failure."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "sv,en;q=0.8",
                "Accept": accept,
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  ! fetch failed: {url} ({e})", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ! unexpected error fetching {url}: {e}", file=sys.stderr)
        return None


def parse_price(text: str) -> Optional[float]:
    """Extracts a price like '17,89' or '17.89' from a string."""
    import re

    if not text:
        return None
    m = re.search(r"\b(\d{1,2})[,.](\d{1,2})\b", text)
    if not m:
        return None
    try:
        return float(f"{m.group(1)}.{m.group(2)}")
    except ValueError:
        return None
