#!/usr/bin/env python3
"""
Tankkollen — fetch fresh Swedish fuel-industry news hourly.

Pulls Google News RSS (language=sv, region=SE) for several fuel /
energy / tax keyword clusters, merges, deduplicates, categorizes
and writes a compact JSON file the frontend renders.

No external dependencies — stdlib only, so the GitHub Actions job
runs in seconds without pip-installing anything.

Output schema matches the shape desktop.js expects:
    {
        "generated_at": "2026-04-17T20:00:00Z",
        "items": [
            {
                "id":        "hash-or-guid",
                "cat":       "pris" | "skatt" | "marknad" | "miljö",
                "source":    "DN",
                "title":     "…",
                "excerpt":   "…",
                "url":       "https://…",
                "published": "2026-04-17T18:42:00Z",
                "hoursAgo":  2,
                "impact":    "-0,08",
                "impactDir": "up" | "down" | "flat"
            },
            ...
        ]
    }
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "data" / "news.json"

# Google News RSS endpoint — no key required, returns XML/RSS 2.0.
# We query multiple keyword clusters and merge results so each
# category has decent coverage.
QUERIES: list[tuple[str, str]] = [
    # (query string, preferred category for items matched only by this query)
    ("drivmedelsskatt OR bensinskatt OR dieselskatt OR reduktionsplikt", "skatt"),
    ("bensinpris OR dieselpris OR drivmedelspris OR pumppris", "pris"),
    ("HVO100 OR biodrivmedel OR elbil OR \"förnybara bränslen\" OR klimat", "miljö"),
    ("OKQ8 OR \"Circle K\" OR Preem OR Ingo OR \"St1\" OR Qstar OR Tanka", "marknad"),
    ("oljepris OR Brent OR \"råolja\" OR OPEC", "marknad"),
]

USER_AGENT = (
    "Mozilla/5.0 (compatible; TankkollenNewsBot/1.0; "
    "+https://github.com/zenbookbird-byte/test)"
)

# How many items we ship to the frontend. Extra buffer so the
# category filter always has something to show.
MAX_ITEMS = 30

# Keyword → category (used to refine category when multiple queries match)
CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    (r"\b(skatt|moms|punktskatt|reduktionsplikt|energiskatt|koldioxidskatt)\b", "skatt"),
    (r"\b(miljö|klimat|utsläpp|elbil|laddning|hvo|biogas|biodrivmedel|förnybar|förnybart)\b", "miljö"),
    (r"\b(pris|dyrare|billigare|höjs|sänks|stigande|fallande|pumppris|bensinpris|dieselpris)\b", "pris"),
    (r"\b(okq8|circle\s*k|preem|ingo|st1|qstar|tanka|shell|kedja|station)\b", "marknad"),
    (r"\b(brent|olja|opec|råolja|raffinaderi)\b", "marknad"),
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def build_query_url(q: str) -> str:
    params = {
        "q": q,
        "hl": "sv",
        "gl": "SE",
        "ceid": "SE:sv",
    }
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)


def parse_rss(xml_bytes: bytes, fallback_cat: str) -> list[dict]:
    """
    Google News RSS shape:
        <rss><channel>
            <item>
                <title>Title — Source</title>
                <link>https://news.google.com/articles/...</link>
                <guid>...</guid>
                <pubDate>Thu, 17 Apr 2026 18:42:00 GMT</pubDate>
                <description><![CDATA[<a href=...>Title</a>&nbsp;<font>Source</font>]]></description>
                <source url="https://www.dn.se/">DN</source>
            </item>
        </channel></rss>
    """
    items: list[dict] = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"  ! RSS parse error: {e}", file=sys.stderr)
        return items

    for item in root.iter("item"):
        title_raw = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or link).strip()
        pub = (item.findtext("pubDate") or "").strip()
        source_el = item.find("source")
        source = source_el.text.strip() if source_el is not None and source_el.text else ""
        description = (item.findtext("description") or "").strip()

        if not title_raw or not link:
            continue

        # Google News titles end with "— Source". Strip if we already have source.
        title = title_raw
        if source and title.endswith(f"— {source}"):
            title = title[: -len(f"— {source}")].strip()
        elif " - " in title and not source:
            # Sometimes only " - Source" is present
            head, _, tail = title.rpartition(" - ")
            if len(tail) < 40:
                title = head.strip()
                source = source or tail.strip()

        excerpt = extract_excerpt(description, title)
        published_iso, hours_ago = parse_pubdate(pub)
        cat = classify(title + " " + excerpt, fallback_cat)
        impact, impact_dir = guess_impact(title, cat)

        items.append({
            "id":        hashlib.md5(guid.encode("utf-8")).hexdigest()[:10],
            "cat":       cat,
            "source":    source or "Google News",
            "title":     title,
            "excerpt":   excerpt,
            "url":       link,
            "published": published_iso,
            "hoursAgo":  hours_ago,
            "impact":    impact,
            "impactDir": impact_dir,
        })

    return items


def extract_excerpt(description: str, title: str) -> str:
    """Strip HTML from Google News description and trim to one sentence."""
    if not description:
        return ""
    # Drop tags
    txt = re.sub(r"<[^>]+>", " ", description)
    txt = html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    # Google News descriptions often just repeat the title — drop if so
    if title and txt.lower().startswith(title.lower()[:40]):
        txt = txt[len(title):].lstrip(" —-·|").strip()
    # Keep it short
    if len(txt) > 260:
        txt = txt[:260].rsplit(" ", 1)[0] + "…"
    return txt


def parse_pubdate(pub: str) -> tuple[str, int]:
    """RFC-822 → ISO-8601 + hours-ago (rounded)."""
    if not pub:
        now = datetime.now(timezone.utc)
        return now.isoformat(timespec="seconds"), 0
    try:
        # Python 3.11+ handles RFC 822 via email.utils
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        dt = datetime.now(timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    hours = max(0, int(delta.total_seconds() // 3600))
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds"), hours


def classify(text: str, fallback: str) -> str:
    """Pick the first matching category by keyword; else fall back."""
    hay = text.lower()
    for pattern, cat in CATEGORY_KEYWORDS:
        if re.search(pattern, hay):
            return cat
    return fallback


def guess_impact(title: str, cat: str) -> tuple[str, str]:
    """
    Heuristic price-impact indicator for the news card footer.
    We cannot know the real effect, so we pick a plausible value
    biased by category and title direction words.
    """
    t = title.lower()
    if any(w in t for w in ("sänks", "sjunker", "faller", "minskar", "billigare", "rabatt", "sänker")):
        return ("-0,08", "down")
    if any(w in t for w in ("höjs", "stiger", "dyrare", "ökar", "höjer", "rekord")):
        return ("+0,10", "up")
    if cat == "skatt":
        return ("+0,05", "up")
    if cat == "miljö":
        return ("-0,03", "down")
    return ("±0,00", "flat")


def main() -> int:
    all_items: dict[str, dict] = {}

    for q, cat in QUERIES:
        url = build_query_url(q)
        print(f"Fetching  [{cat:<7}]  {q}")
        try:
            xml = fetch(url)
        except Exception as e:
            print(f"  ! fetch failed: {e}", file=sys.stderr)
            continue
        parsed = parse_rss(xml, fallback_cat=cat)
        print(f"  parsed   {len(parsed):>3} items")
        for it in parsed:
            # De-dupe by id (same guid across queries collapses to one)
            existing = all_items.get(it["id"])
            if existing is None or it["hoursAgo"] < existing["hoursAgo"]:
                all_items[it["id"]] = it

    merged = sorted(all_items.values(), key=lambda n: n["hoursAgo"])[:MAX_ITEMS]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items":        merged,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("-" * 60)
    print(f"Wrote {OUTPUT.relative_to(HERE.parent.parent)}  ({len(merged)} items, "
          f"{OUTPUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
