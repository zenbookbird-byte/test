"""
Official chain list-price scrapers.

Each function fetches one specific brand's public list-price page and
returns a dict of list prices, or None on failure.
"""

from __future__ import annotations

import re
from typing import Dict, Optional

from ._http import http_get, parse_price


PriceDict = Dict[str, Optional[float]]


def _search_patterns(html: str, patterns: Dict[str, str]) -> PriceDict:
    result: PriceDict = {}
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        result[fuel] = parse_price(m.group(1)) if m else None
    return result


# ---------------------------------------------------------------------------
# Circle K
# ---------------------------------------------------------------------------
def scrape_circle_k() -> Optional[PriceDict]:
    html = http_get("https://www.circlek.se/drivmedel/drivmedelspriser")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:miles\s*)?Bensin\s*95[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:miles\s*)?Bensin\s*98[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:miles\s*)?Diesel\b[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    prices.setdefault("e85", None)
    return prices if any(v for v in prices.values()) else None


# ---------------------------------------------------------------------------
# OKQ8
# ---------------------------------------------------------------------------
def scrape_okq8() -> Optional[PriceDict]:
    html = http_get("https://www.okq8.se/pa-stationen/drivmedel")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:GoEasy\s*)?(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:GoEasy\s*)?(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:GoEasy\s*)?Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    return prices if any(v for v in prices.values()) else None


# ---------------------------------------------------------------------------
# Preem
# ---------------------------------------------------------------------------
def scrape_preem() -> Optional[PriceDict]:
    html = http_get("https://www.preem.se/privat/drivmedel/priser/")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:Preem\s*)?(?:Evolution\s*)?(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Preem\s*)?(?:Evolution\s*)?(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:Preem\s*)?Evolution\s*Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    if prices.get("diesel") is None:
        m = re.search(r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})", html, re.IGNORECASE)
        if m:
            prices["diesel"] = parse_price(m.group(1))
    return prices if any(v for v in prices.values()) else None


# ---------------------------------------------------------------------------
# St1 / Shell (same operator in Sweden)
# ---------------------------------------------------------------------------
def scrape_st1() -> Optional[PriceDict]:
    html = http_get("https://www.st1.se/drivmedel/drivmedelspriser")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:Diesel\s*Plus|Diesel)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    return prices if any(v for v in prices.values()) else None


def scrape_shell() -> Optional[PriceDict]:
    return scrape_st1()


# ---------------------------------------------------------------------------
# Tanka
# ---------------------------------------------------------------------------
def scrape_tanka() -> Optional[PriceDict]:
    html = http_get("https://www.tanka.se/")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:Bensin\s*95)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Bensin\s*98)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    return prices if any(v for v in prices.values()) else None


# ---------------------------------------------------------------------------
# Qstar
# ---------------------------------------------------------------------------
def scrape_qstar() -> Optional[PriceDict]:
    html = http_get("https://www.qstar.se/drivmedel")
    if not html:
        return None
    patterns = {
        "bensin95": r"(?:Bensin\s*95)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    prices = _search_patterns(html, patterns)
    return prices if any(v for v in prices.values()) else None


SCRAPERS = {
    "Circle K": scrape_circle_k,
    "OKQ8":     scrape_okq8,
    "Preem":    scrape_preem,
    "St1":      scrape_st1,
    "Shell":    scrape_shell,
    "Tanka":    scrape_tanka,
    "Qstar":    scrape_qstar,
}
