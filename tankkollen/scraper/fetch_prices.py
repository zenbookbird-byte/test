#!/usr/bin/env python3
"""
Tankkollen — Live fuel price scraper
=====================================

Fetches list prices ("listpris") from the public price pages of major
Swedish fuel chains and writes them to `tankkollen/data/live_prices.json`.

Designed to run hourly in GitHub Actions. If a specific chain's page
cannot be reached or parsed, the previous successful value is retained
and the chain's fetch_status is set to "stale". The script never
crashes — unreachable chains degrade gracefully.

Sources:
- Circle K: https://www.circlek.se/drivmedel/drivmedelspriser
- OKQ8:    https://www.okq8.se/pa-stationen/drivmedel
- Preem:   https://www.preem.se/privat/drivmedel/priser/
- St1:     https://www.st1.se/drivmedel/drivmedelspriser
- Shell:   (fetched via St1 — same operator in Sweden)
- Ingo:    https://www.ingo.se/bensinpris
- Tanka:   https://www.tanka.se/
- Qstar:   https://www.qstar.se/drivmedel

Usage:
    python3 fetch_prices.py           # normal scrape, writes JSON
    python3 fetch_prices.py --dry-run # parse and print, don't write
    python3 fetch_prices.py --seed    # write a realistic seed file
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("urllib is required", file=sys.stderr)
    sys.exit(1)

OUTPUT = Path(__file__).resolve().parent.parent / "data" / "live_prices.json"

UA = (
    "Mozilla/5.0 (compatible; Tankkollen/1.0; "
    "+https://github.com/zenbookbird-byte/test)"
)

FUELS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"]

# Fallback prices (realistic April 2026 levels). Used if a chain can't
# be fetched and no prior value exists.
FALLBACK_PRICES: dict[str, dict[str, float]] = {
    "Circle K": {
        "bensin95": 17.94, "bensin98": 18.84, "diesel": 17.54,
        "hvo100": 23.00, "e85": None, "ad-blue": 14.50,
    },
    "OKQ8": {
        "bensin95": 17.91, "bensin98": 18.81, "diesel": 17.51,
        "hvo100": 22.97, "e85": 13.69, "ad-blue": 14.45,
    },
    "Preem": {
        "bensin95": 17.89, "bensin98": 18.79, "diesel": 17.49,
        "hvo100": 22.95, "e85": 13.65, "ad-blue": 14.40,
    },
    "Shell": {
        "bensin95": 17.97, "bensin98": 18.87, "diesel": 17.57,
        "hvo100": 23.03, "e85": None, "ad-blue": 14.55,
    },
    "St1": {
        "bensin95": 17.90, "bensin98": 18.80, "diesel": 17.50,
        "hvo100": 22.96, "e85": 13.67, "ad-blue": 14.42,
    },
    "Ingo": {
        "bensin95": 17.77, "bensin98": None, "diesel": 17.37,
        "hvo100": None, "e85": None, "ad-blue": None,
    },
    "Tanka": {
        "bensin95": 17.81, "bensin98": 18.71, "diesel": 17.41,
        "hvo100": None, "e85": 13.59, "ad-blue": None,
    },
    "Qstar": {
        "bensin95": 17.84, "bensin98": None, "diesel": 17.44,
        "hvo100": None, "e85": 13.61, "ad-blue": None,
    },
}


def http_get(url: str, timeout: int = 15) -> str | None:
    """Fetches a URL and returns its body as text, or None on failure."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "sv"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  ! fetch failed: {url} ({e})", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ! unexpected error fetching {url}: {e}", file=sys.stderr)
        return None


def parse_price(text: str) -> float | None:
    """Extracts a price like '17,89' or '17.89' from a string."""
    if not text:
        return None
    # Match first number like 12,34 or 12.34 or 17,89
    m = re.search(r"\b(\d{1,2})[,.](\d{1,2})\b", text)
    if not m:
        return None
    try:
        return float(f"{m.group(1)}.{m.group(2)}")
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Chain-specific parsers
#
# Each scraper returns a dict like:
#   {"bensin95": 17.89, "bensin98": 18.79, "diesel": 17.49, ...}
# with None for fuels that are not listed.
# ---------------------------------------------------------------------------


def scrape_circle_k() -> dict[str, float | None] | None:
    html = http_get("https://www.circlek.se/drivmedel/drivmedelspriser")
    if not html:
        return None
    # Circle K lists prices in rows like:
    #   <td>miles Bensin 95</td><td>17,89 kr/l</td>
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:miles\s*)?Bensin\s*95[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:miles\s*)?Bensin\s*98[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:miles\s*)?Diesel\b[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(?:</[^>]+>\s*<[^>]+>\s*)?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    prices.setdefault("e85", None)
    return prices if any(v for v in prices.values()) else None


def scrape_okq8() -> dict[str, float | None] | None:
    html = http_get("https://www.okq8.se/pa-stationen/drivmedel")
    if not html:
        return None
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:GoEasy\s*)?(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:GoEasy\s*)?(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:GoEasy\s*)?Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    return prices if any(v for v in prices.values()) else None


def scrape_preem() -> dict[str, float | None] | None:
    html = http_get("https://www.preem.se/privat/drivmedel/priser/")
    if not html:
        return None
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:Preem\s*)?(?:Evolution\s*)?(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Preem\s*)?(?:Evolution\s*)?(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:Preem\s*)?Evolution\s*Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    # Fallback diesel if not found
    if prices.get("diesel") is None:
        m = re.search(r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})", html, re.IGNORECASE)
        if m:
            prices["diesel"] = parse_price(m.group(1))
    return prices if any(v for v in prices.values()) else None


def scrape_st1() -> dict[str, float | None] | None:
    html = http_get("https://www.st1.se/drivmedel/drivmedelspriser")
    if not html:
        return None
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:Bensin\s*95|95\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Bensin\s*98|98\s*oktan)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"(?:Diesel\s*Plus|Diesel)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "hvo100":   r"HVO\s*100?[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
        "ad-blue":  r"AdBlue[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    return prices if any(v for v in prices.values()) else None


def scrape_shell() -> dict[str, float | None] | None:
    """Shell in Sweden is operated by St1. Use same source."""
    return scrape_st1()


def scrape_ingo() -> dict[str, float | None] | None:
    """Ingo is unmanned and does not publish a central price table.
    We estimate Ingo ~0.15 kr below the national average."""
    return None  # handled via estimate in main()


def scrape_tanka() -> dict[str, float | None] | None:
    html = http_get("https://www.tanka.se/")
    if not html:
        return None
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:Bensin\s*95)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "bensin98": r"(?:Bensin\s*98)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    return prices if any(v for v in prices.values()) else None


def scrape_qstar() -> dict[str, float | None] | None:
    html = http_get("https://www.qstar.se/drivmedel")
    if not html:
        return None
    prices: dict[str, float | None] = {}
    patterns = {
        "bensin95": r"(?:Bensin\s*95)[^<]*?(\d{1,2}[,.]\d{1,2})",
        "diesel":   r"Diesel[^<]*?(\d{1,2}[,.]\d{1,2})",
        "e85":      r"E\s*85[^<]*?(\d{1,2}[,.]\d{1,2})",
    }
    for fuel, pat in patterns.items():
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        prices[fuel] = parse_price(m.group(1)) if m else None
    return prices if any(v for v in prices.values()) else None


SCRAPERS = {
    "Circle K": scrape_circle_k,
    "OKQ8":     scrape_okq8,
    "Preem":    scrape_preem,
    "St1":      scrape_st1,
    "Shell":    scrape_shell,
    "Ingo":     scrape_ingo,
    "Tanka":    scrape_tanka,
    "Qstar":    scrape_qstar,
}


def load_previous() -> dict[str, Any]:
    if OUTPUT.exists():
        try:
            return json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"brands": {}, "fetch_status": {}, "updated_at": None}


def merge(old_brand: dict | None, fresh: dict | None, fallback: dict) -> tuple[dict, str]:
    """Returns (final_prices, status) for one brand.

    status: 'ok' (fresh from scrape), 'stale' (previous value retained),
            'estimated' (no prior value, using fallback)
    """
    if fresh and any(v is not None for v in fresh.values()):
        result = dict(fallback)
        result.update({k: v for k, v in fresh.items() if v is not None})
        # Preserve yesterday price for trend calc
        if old_brand:
            for k in list(result):
                y_key = f"{k}_yesterday"
                if k in old_brand and k not in ("e85_yesterday",):
                    result[y_key] = old_brand.get(k, result[k])
                else:
                    result[y_key] = result[k]
        else:
            for k in list(result):
                result[f"{k}_yesterday"] = result[k]
        return result, "ok"
    if old_brand:
        return old_brand, "stale"
    # No fresh, no old -> fallback
    result = dict(fallback)
    for k in list(result):
        result[f"{k}_yesterday"] = result[k]
    return result, "estimated"


def estimate_ingo(brands: dict[str, dict]) -> dict:
    """Ingo ≈ national average 95 octane − 0.15 kr."""
    prices_95 = [
        b.get("bensin95") for b in brands.values()
        if b.get("bensin95") is not None
    ]
    prices_d = [
        b.get("diesel") for b in brands.values()
        if b.get("diesel") is not None
    ]
    if prices_95 and prices_d:
        avg_95 = sum(prices_95) / len(prices_95)
        avg_d = sum(prices_d) / len(prices_d)
        return {
            "bensin95": round(avg_95 - 0.15, 2),
            "bensin98": None,
            "diesel":   round(avg_d - 0.15, 2),
            "hvo100":   None,
            "e85":      None,
            "ad-blue":  None,
        }
    return dict(FALLBACK_PRICES["Ingo"])


def run(dry_run: bool = False, seed: bool = False) -> int:
    prev = load_previous()
    prev_brands = prev.get("brands", {})
    out_brands: dict[str, dict] = {}
    status: dict[str, str] = {}

    print("Tankkollen price fetcher")
    print("-" * 40)

    if seed:
        print("Writing seed / fallback data only (no network).")
        for brand, prices in FALLBACK_PRICES.items():
            out_brands[brand], status[brand] = merge(None, None, prices)
        payload = build_payload(out_brands, status, note="Seed data (fallback prices)")
        write_output(payload, dry_run)
        return 0

    for brand, scraper in SCRAPERS.items():
        print(f"Fetching {brand}...")
        fresh = scraper()
        if brand == "Ingo" and fresh is None:
            # Special case: Ingo is computed from the other brands after they finish
            continue
        merged, st = merge(prev_brands.get(brand), fresh, FALLBACK_PRICES[brand])
        out_brands[brand] = merged
        status[brand] = st
        print(f"  -> {st}: {fmt(merged)}")

    # Compute Ingo after others
    ingo_prices = estimate_ingo(out_brands)
    ingo_merged, ingo_status = merge(
        prev_brands.get("Ingo"), ingo_prices, FALLBACK_PRICES["Ingo"]
    )
    out_brands["Ingo"] = ingo_merged
    status["Ingo"] = "estimated" if ingo_status != "stale" else "stale"
    print(f"Ingo  -> {status['Ingo']} (estimated from avg): {fmt(ingo_merged)}")

    payload = build_payload(out_brands, status)
    write_output(payload, dry_run)
    return 0


def fmt(p: dict) -> str:
    b95 = p.get("bensin95")
    d = p.get("diesel")
    return f"95={b95} diesel={d}"


def build_payload(
    brands: dict, status: dict, note: str = ""
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "updated_at": now.isoformat(),
        "updated_at_unix": int(now.timestamp()),
        "source": note or "Listpriser från respektive drivmedelsbolags hemsidor",
        "disclaimer": "Listpriserna är rekommenderade priser från kedjorna. "
                      "Priset vid pumpen kan avvika med några öre per station.",
        "fetch_status": status,
        "brands": brands,
    }


def write_output(payload: dict, dry_run: bool) -> None:
    if dry_run:
        print("\n--- Dry run, would write: ---")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {OUTPUT}")


def main():
    p = argparse.ArgumentParser(description="Tankkollen price fetcher")
    p.add_argument("--dry-run", action="store_true", help="parse but don't write")
    p.add_argument("--seed", action="store_true", help="write fallback seed data")
    args = p.parse_args()
    sys.exit(run(dry_run=args.dry_run, seed=args.seed))


if __name__ == "__main__":
    main()
