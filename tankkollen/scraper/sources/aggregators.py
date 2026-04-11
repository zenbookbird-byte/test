"""
Crowdsourced aggregator site scrapers.

These sites collect user-reported prices from all across Sweden and
publish station-level prices that are much more granular than the
chains' own list prices. We pull them to:

1. Fill in brands that don't publish centrally (Ingo, small chains).
2. Cross-validate the official list prices.
3. Provide a "cheapest reported nationally" indicator for the UI.

All parsers are best-effort regex + simple HTML walking, aggregator
sites change markup frequently, so failures must degrade gracefully.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from ._http import http_get, parse_price


# ---------------------------------------------------------------------------
# Bensinpriser.nu
# ---------------------------------------------------------------------------

BENSINPRISER_BASE = "https://bensinpriser.nu"


def scrape_bensinpriser_nu() -> Optional[Dict]:
    """Scrapes the homepage for top-cheapest-now lists per fuel.

    Returns:
        {
          "meta": {...},
          "national_low": {"bensin95": 15.89, "diesel": 15.49, ...},
          "cheapest_reported": [
              {"brand": "Ingo", "city": "Stockholm", "fuel": "bensin95",
               "price": 15.89, "reported_at": "..."},
              ...
          ],
        }
    """
    html = http_get(f"{BENSINPRISER_BASE}/")
    if not html:
        return None

    national_low: Dict[str, Optional[float]] = {}
    cheapest_reported: List[Dict] = []

    # Homepage typically has blocks like:
    # <h2>Bensin 95 - billigast just nu</h2>
    # <ol>
    #   <li>Ingo Stockholm ... 15,89 kr/l</li>
    #   ...
    # </ol>
    blocks = re.findall(
        r"(Bensin\s*95|Bensin\s*98|Diesel|E\s*85)[^<]*?(?:billigast|lägst|just\s*nu)"
        r".*?<ol[^>]*>(.*?)</ol>",
        html,
        re.IGNORECASE | re.DOTALL,
    )

    fuel_map = {
        "bensin 95": "bensin95",
        "bensin95":  "bensin95",
        "bensin 98": "bensin98",
        "bensin98":  "bensin98",
        "diesel":    "diesel",
        "e 85":      "e85",
        "e85":       "e85",
    }

    for header, ol_html in blocks:
        key = fuel_map.get(header.lower().strip())
        if not key:
            continue
        items = re.findall(
            r"<li[^>]*>(.*?)</li>", ol_html, re.IGNORECASE | re.DOTALL
        )
        for raw in items[:10]:
            text = re.sub(r"<[^>]+>", " ", raw)
            text = re.sub(r"\s+", " ", text).strip()
            price = parse_price(text)
            if price is None:
                continue
            # First token often = brand, remainder = city
            parts = text.split()
            brand = parts[0] if parts else ""
            entry = {
                "fuel": key,
                "price": price,
                "text": text,
                "brand": brand,
            }
            cheapest_reported.append(entry)
            prev = national_low.get(key)
            if prev is None or price < prev:
                national_low[key] = price

    if not cheapest_reported:
        return None

    return {
        "meta": {
            "source": "Bensinpriser.nu (crowdsourced)",
            "url": BENSINPRISER_BASE,
        },
        "national_low": national_low,
        "cheapest_reported": cheapest_reported,
    }


def scrape_bensinpriser_county(county_slug: str, fuel_code: str = "95") -> Optional[List[Dict]]:
    """Scrapes a per-county listing, e.g. /stationer/95/stockholms-lan/.

    Returns a list of station dicts: [{brand, name, price, city, reporter}, ...]
    """
    url = f"{BENSINPRISER_BASE}/stationer/{fuel_code}/{county_slug}"
    html = http_get(url)
    if not html:
        return None

    rows = re.findall(
        r"<tr[^>]*>.*?</tr>",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    stations: List[Dict] = []
    for row in rows:
        if not re.search(r"\d+[,.]\d{1,2}", row):
            continue
        text = re.sub(r"<[^>]+>", " ", row)
        text = re.sub(r"\s+", " ", text).strip()
        price = parse_price(text)
        if price is None:
            continue
        stations.append({"text": text, "price": price})
    return stations or None


# ---------------------------------------------------------------------------
# Bensinstation.nu
# ---------------------------------------------------------------------------

def scrape_bensinstation_nu() -> Optional[Dict]:
    """Scrapes Bensinstation.nu landing page for national averages and
    cheapest reported."""
    html = http_get("https://www.bensinstation.nu/")
    if not html:
        return None

    national_avg: Dict[str, Optional[float]] = {}
    labels = {
        "bensin95": [r"Bensin\s*95", r"95\s*oktan"],
        "bensin98": [r"Bensin\s*98", r"98\s*oktan"],
        "diesel":   [r"Diesel"],
        "e85":      [r"E\s*85"],
        "hvo100":   [r"HVO\s*100"],
    }
    for key, patterns in labels.items():
        for pat in patterns:
            m = re.search(
                rf"{pat}[^<]*?(\d{{1,2}}[,.]\d{{1,2}})",
                html,
                re.IGNORECASE | re.DOTALL,
            )
            if m:
                national_avg[key] = parse_price(m.group(1))
                break

    if not any(v is not None for v in national_avg.values()):
        return None

    return {
        "meta": {
            "source": "Bensinstation.nu",
            "url": "https://www.bensinstation.nu/",
        },
        "national_avg": national_avg,
    }


# ---------------------------------------------------------------------------
# Bensinpris Idag (bensinprisidag.se)
# ---------------------------------------------------------------------------

def scrape_bensinpris_idag() -> Optional[Dict]:
    html = http_get("https://bensinprisidag.se/")
    if not html:
        return None

    national_avg: Dict[str, Optional[float]] = {}
    labels = {
        "bensin95": r"(?:Bensin\s*95|95\s*oktan)",
        "bensin98": r"(?:Bensin\s*98|98\s*oktan)",
        "diesel":   r"Diesel",
        "e85":      r"E\s*85",
    }
    for key, pat in labels.items():
        m = re.search(
            rf"{pat}[^<]*?(\d{{1,2}}[,.]\d{{1,2}})",
            html,
            re.IGNORECASE | re.DOTALL,
        )
        if m:
            national_avg[key] = parse_price(m.group(1))

    if not any(v is not None for v in national_avg.values()):
        return None

    return {
        "meta": {
            "source": "Bensinpris Idag (bensinprisidag.se)",
            "url": "https://bensinprisidag.se/",
        },
        "national_avg": national_avg,
    }


AGGREGATORS = {
    "bensinpriser_nu":  scrape_bensinpriser_nu,
    "bensinstation_nu": scrape_bensinstation_nu,
    "bensinpris_idag":  scrape_bensinpris_idag,
}
