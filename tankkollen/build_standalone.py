#!/usr/bin/env python3
"""
Build a single-file, fully-offline version of Tankkollen Pro.

Reads ``dator.html`` and inlines every <link rel="stylesheet"> and
<script src=""> referencing a local asset, plus embeds the live
prices JSON as ``window.__LIVE_PRICES_DATA__`` so the page works
when opened via ``file://`` (no HTTP server, no Python needed).

Outputs ``tankkollen_offline.html`` in the repo root. Users can
download that single file from GitHub and double-click it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
OUTPUT = REPO_ROOT / "tankkollen_offline.html"
SOURCE = HERE / "dator.html"


def read(rel: str) -> str:
    p = HERE / rel
    return p.read_text(encoding="utf-8")


def escape_for_script(text: str) -> str:
    """Escapes any </script> sequences so embedded JS doesn't break out."""
    return text.replace("</script>", "<\\/script>")


def inline_stylesheet(match: re.Match) -> str:
    href = match.group(1)
    if href.startswith(("http://", "https://", "//")):
        return match.group(0)  # keep external fonts / CDN as-is
    try:
        css = read(href)
    except FileNotFoundError:
        print(f"  ! missing stylesheet: {href}")
        return match.group(0)
    print(f"  inlined stylesheet  {href:<40} {len(css):>7} bytes")
    return f"<style data-src=\"{href}\">\n{css}\n</style>"


def inline_script(match: re.Match) -> str:
    src = match.group(1)
    if src.startswith(("http://", "https://", "//")):
        return match.group(0)
    try:
        js = read(src)
    except FileNotFoundError:
        print(f"  ! missing script: {src}")
        return match.group(0)
    print(f"  inlined script      {src:<40} {len(js):>7} bytes")
    return f"<script data-src=\"{src}\">\n{escape_for_script(js)}\n</script>"


def main() -> int:
    print(f"Building {OUTPUT.relative_to(REPO_ROOT)}")
    print("-" * 60)

    html = SOURCE.read_text(encoding="utf-8")

    # 1. Drop the file:// fallback banner — the whole point of the
    #    standalone build is to work from file://, so the banner would
    #    always trigger and hide the app.
    html = re.sub(
        r"<!-- file:// fallback banner.*?</script>\s*",
        "",
        html,
        count=1,
        flags=re.DOTALL,
    )

    # 2. Bake the live prices JSON into a global before prices.js runs
    live_prices = json.loads(
        (REPO_ROOT / "tankkollen" / "data" / "live_prices.json").read_text(
            encoding="utf-8"
        )
    )
    prices_preload = (
        "<script>window.__LIVE_PRICES_DATA__ = "
        + json.dumps(live_prices, ensure_ascii=False)
        + ";</script>"
    )
    print(f"  embedded live_prices.json                       {len(prices_preload):>7} bytes")

    # Insert the preload right before the first <script src="js/prices.js">
    html = html.replace(
        '<script src="js/prices.js"></script>',
        prices_preload + '\n    <script src="js/prices.js"></script>',
    )

    # 3. Inline every local <link rel="stylesheet">
    html = re.sub(
        r'<link rel="stylesheet" href="([^"]+)"\s*/?>',
        inline_stylesheet,
        html,
    )

    # 4. Inline every local <script src="...">
    html = re.sub(
        r'<script src="([^"]+)"></script>',
        inline_script,
        html,
    )

    # 5. Strip Google AdSense loader — blocked by CORS on file:// and
    #    just throws console errors. No ads to show in the offline build.
    html = re.sub(
        r"<!--\s*Google AdSense.*?-->\s*<script[^>]*pagead2\.googlesyndication\.com[^<]*</script>",
        "<!-- AdSense removed for offline build -->",
        html,
        flags=re.DOTALL,
    )

    # 6. Add a small offline notice + a help comment at the top
    header_note = (
        '<!--\n'
        '  Tankkollen Pro — standalone offline build\n'
        '  --------------------------------------------------------\n'
        '  Single-file, fully self-contained desktop dashboard.\n'
        '  Double-click this file to open it in your default browser.\n'
        '  No server, no Python, no dependencies required.\n'
        '  Live prices are baked in as of the timestamp shown in\n'
        "  the LIVE indicator. To refresh, re-download from GitHub.\n"
        '-->\n'
    )
    html = header_note + html

    OUTPUT.write_text(html, encoding="utf-8")
    size = OUTPUT.stat().st_size
    print("-" * 60)
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)}  ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
