#!/usr/bin/env python3
"""
Tankkollen, Live fuel price scraper (multi-source)
=====================================================

Pulls pricing data from a priority chain of sources:

  1. Official chain list-price pages        (sources/chains.py)
  2. Crowdsourced aggregator sites          (sources/aggregators.py)
  3. Industry / government statistics       (sources/industry.py)
  4. Cached previous value                  (previous live_prices.json)
  5. Realistic hand-written fallback        (FALLBACK_PRICES)

Priority is highest-trust-first. For each (brand, fuel) pair the
scraper walks down the chain until it finds a non-None value and
records which tier it came from in ``fetch_status``.

The orchestrator never raises. Unreachable sources degrade to "stale"
or "estimated" and the app keeps working.

Usage:
    python3 fetch_prices.py           # normal, writes JSON
    python3 fetch_prices.py --dry-run # parse and print, don't write
    python3 fetch_prices.py --seed    # write fallback seed only
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import chains, aggregators, industry  # noqa: E402


OUTPUT = Path(__file__).resolve().parent.parent / "data" / "live_prices.json"

FUELS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"]

# Realistic April 2026 fallback prices (used only if *every* live
# source is unreachable AND there's no cached value from last run).
FALLBACK_PRICES: Dict[str, Dict[str, Optional[float]]] = {
    "Circle K": {"bensin95": 17.94, "bensin98": 18.84, "diesel": 17.54, "hvo100": 23.00, "e85": None, "ad-blue": 14.50},
    "OKQ8":     {"bensin95": 17.91, "bensin98": 18.81, "diesel": 17.51, "hvo100": 22.97, "e85": 13.69, "ad-blue": 14.45},
    "Preem":    {"bensin95": 17.89, "bensin98": 18.79, "diesel": 17.49, "hvo100": 22.95, "e85": 13.65, "ad-blue": 14.40},
    "Shell":    {"bensin95": 17.97, "bensin98": 18.87, "diesel": 17.57, "hvo100": 23.03, "e85": None, "ad-blue": 14.55},
    "St1":      {"bensin95": 17.90, "bensin98": 18.80, "diesel": 17.50, "hvo100": 22.96, "e85": 13.67, "ad-blue": 14.42},
    "Ingo":     {"bensin95": 17.77, "bensin98": None,  "diesel": 17.37, "hvo100": None,  "e85": None, "ad-blue": None},
    "Tanka":    {"bensin95": 17.81, "bensin98": 18.71, "diesel": 17.41, "hvo100": None,  "e85": 13.59, "ad-blue": None},
    "Qstar":    {"bensin95": 17.84, "bensin98": None,  "diesel": 17.44, "hvo100": None,  "e85": 13.61, "ad-blue": None},
}


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def load_previous() -> Dict[str, Any]:
    if OUTPUT.exists():
        try:
            return json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"brands": {}, "fetch_status": {}, "updated_at": None}


def write_output(payload: Dict[str, Any], dry_run: bool) -> None:
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


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_chain_scrapers() -> Dict[str, Optional[Dict[str, Optional[float]]]]:
    print("\n[1/3] Chain list prices")
    print("-" * 40)
    results: Dict[str, Optional[Dict[str, Optional[float]]]] = {}
    for brand, fn in chains.SCRAPERS.items():
        print(f"  · {brand}...", end=" ", flush=True)
        try:
            fresh = fn()
        except Exception as e:
            print(f"error ({e})")
            fresh = None
            continue
        if fresh and any(v for v in fresh.values()):
            print("ok")
        else:
            print("no data")
        results[brand] = fresh
    return results


def run_aggregators() -> Dict[str, Optional[Dict]]:
    print("\n[2/3] Crowdsourced aggregators")
    print("-" * 40)
    results: Dict[str, Optional[Dict]] = {}
    for name, fn in aggregators.AGGREGATORS.items():
        print(f"  · {name}...", end=" ", flush=True)
        try:
            data = fn()
        except Exception as e:
            print(f"error ({e})")
            data = None
        else:
            print("ok" if data else "no data")
        results[name] = data
    return results


def run_industry() -> Dict[str, Optional[Dict]]:
    print("\n[3/3] Industry / government statistics")
    print("-" * 40)
    results: Dict[str, Optional[Dict]] = {}
    for name, fn in industry.INDUSTRY_SOURCES.items():
        print(f"  · {name}...", end=" ", flush=True)
        try:
            data = fn()
        except Exception as e:
            print(f"error ({e})")
            data = None
        else:
            print("ok" if data else "no data")
        results[name] = data
    return results


def national_average_from_aggregators(aggs: Dict[str, Optional[Dict]]) -> Dict[str, float]:
    """Computes a combined national average across all aggregator sources."""
    buckets: Dict[str, list] = {k: [] for k in FUELS}
    for data in aggs.values():
        if not data:
            continue
        avg = data.get("national_avg") or {}
        low = data.get("national_low") or {}
        for fuel in FUELS:
            for source in (avg, low):
                v = source.get(fuel)
                if isinstance(v, (int, float)):
                    buckets[fuel].append(float(v))
    return {
        fuel: round(sum(vals) / len(vals), 2) if vals else None
        for fuel, vals in buckets.items()
    }


def merge_brand(
    brand: str,
    prev_brand: Optional[Dict],
    chain_fresh: Optional[Dict[str, Optional[float]]],
    national_avg: Dict[str, Optional[float]],
    fallback: Dict[str, Optional[float]],
) -> tuple[Dict[str, Any], Dict[str, str]]:
    """Merges sources for one brand in priority order.

    Priority per fuel:
      1. chain_fresh[fuel]             (official list price)
      2. national_avg[fuel] + brand adjustment   (crowdsource-derived)
      3. prev_brand[fuel]              (cached from last run)
      4. fallback[fuel]                (hand-written realistic value)
    """
    # Brand-specific offset relative to national average
    BRAND_OFFSET = {
        "Circle K": 0.05, "OKQ8": 0.02, "Preem": 0.00,
        "Shell": 0.08,    "St1": 0.01,  "Ingo": -0.12,
        "Tanka": -0.08,   "Qstar": -0.05,
    }
    offset = BRAND_OFFSET.get(brand, 0.0)

    result: Dict[str, Any] = {}
    sources: Dict[str, str] = {}

    for fuel in FUELS:
        val = None
        src = None
        if chain_fresh and chain_fresh.get(fuel) is not None:
            val = chain_fresh[fuel]
            src = "chain_official"
        elif national_avg.get(fuel) is not None:
            val = round(national_avg[fuel] + offset, 2)
            src = "crowdsourced_avg"
        elif prev_brand and prev_brand.get(fuel) is not None:
            val = prev_brand[fuel]
            src = "cached"
        elif fallback.get(fuel) is not None:
            val = fallback[fuel]
            src = "fallback"
        result[fuel] = val
        sources[fuel] = src or "missing"

        # Preserve previous price as yesterday for trend calc
        if prev_brand and prev_brand.get(fuel) is not None:
            result[f"{fuel}_yesterday"] = prev_brand[fuel]
        elif val is not None:
            result[f"{fuel}_yesterday"] = val

    return result, sources


def aggregate_brand_status(fuel_sources: Dict[str, str]) -> str:
    """Reduces a per-fuel source map to a single brand status."""
    vals = set(fuel_sources.values()) - {"missing"}
    if "chain_official" in vals:
        return "ok"
    if "crowdsourced_avg" in vals:
        return "crowdsourced"
    if "cached" in vals:
        return "stale"
    if "fallback" in vals:
        return "estimated"
    return "missing"


def build_payload(
    brands: Dict[str, Dict],
    fetch_status: Dict[str, str],
    per_fuel_sources: Dict[str, Dict[str, str]],
    aggregators_raw: Dict[str, Optional[Dict]],
    industry_raw: Dict[str, Optional[Dict]],
    national_avg: Dict[str, Optional[float]],
    note: str = "",
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    sources_list = []
    for name, data in {**aggregators_raw, **industry_raw}.items():
        sources_list.append({
            "id": name,
            "available": data is not None,
            "meta": (data or {}).get("meta") if data else None,
        })
    return {
        "updated_at": now.isoformat(),
        "updated_at_unix": int(now.timestamp()),
        "source": note or "Multi-source pipeline: kedjornas listpriser + crowdsourcing + branschstatistik",
        "disclaimer":
            "Priserna hämtas från kedjornas egna sidor, aggregator­sajter (Bensinpriser.nu m.fl.) "
            "och branschorganet Drivkraft Sverige. Priset vid pumpen kan avvika med några öre per station.",
        "fetch_status": fetch_status,
        "per_fuel_sources": per_fuel_sources,
        "national_average": national_avg,
        "data_sources": sources_list,
        "brands": brands,
    }


def run(dry_run: bool = False, seed: bool = False) -> int:
    prev = load_previous()
    prev_brands = prev.get("brands", {})

    print("Tankkollen multi-source price pipeline")
    print("=" * 40)

    if seed:
        print("Seed mode: writing fallback data (no network)")
        out_brands = {}
        status = {}
        per_fuel = {}
        for brand, prices in FALLBACK_PRICES.items():
            merged, fs = merge_brand(brand, None, None, {}, prices)
            out_brands[brand] = merged
            per_fuel[brand] = fs
            status[brand] = aggregate_brand_status(fs)
        payload = build_payload(
            out_brands, status, per_fuel, {}, {}, {},
            note="Seed data (fallback prices)",
        )
        write_output(payload, dry_run)
        return 0

    chain_data = run_chain_scrapers()
    agg_data = run_aggregators()
    ind_data = run_industry()

    # Merge national average from aggregators + industry
    combined = {**agg_data, **ind_data}
    national_avg = national_average_from_aggregators(combined)
    print(f"\nNational average (merged across sources): {national_avg}")

    out_brands: Dict[str, Dict] = {}
    status: Dict[str, str] = {}
    per_fuel: Dict[str, Dict[str, str]] = {}

    for brand, fallback in FALLBACK_PRICES.items():
        merged, fs = merge_brand(
            brand,
            prev_brands.get(brand),
            chain_data.get(brand),
            national_avg,
            fallback,
        )
        out_brands[brand] = merged
        per_fuel[brand] = fs
        status[brand] = aggregate_brand_status(fs)
        print(f"  {brand:9}  status={status[brand]}")

    payload = build_payload(
        out_brands, status, per_fuel, agg_data, ind_data, national_avg
    )
    write_output(payload, dry_run)
    return 0


def main():
    p = argparse.ArgumentParser(description="Tankkollen multi-source price pipeline")
    p.add_argument("--dry-run", action="store_true", help="parse but don't write")
    p.add_argument("--seed", action="store_true", help="write fallback seed")
    args = p.parse_args()
    sys.exit(run(dry_run=args.dry_run, seed=args.seed))


if __name__ == "__main__":
    main()
