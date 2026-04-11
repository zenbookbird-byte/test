#!/usr/bin/env python3
"""
Tankkollen, fetch real fuel station locations from OpenStreetMap.

Writes ``tankkollen/data/stations_osm.json`` with every amenity=fuel
node/way in Sweden. Intended to be run on a slow schedule (weekly or
monthly) since OSM data doesn't change often.

Attribution: © OpenStreetMap contributors. The data is licensed under
ODbL and the UI displays an attribution notice when using this source.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import osm  # noqa: E402


OUTPUT = Path(__file__).resolve().parent.parent / "data" / "stations_osm.json"


def main() -> int:
    print("Tankkollen, OSM station fetcher")
    print("-" * 40)
    print("Fetching every amenity=fuel in Sweden...")
    stations = osm.fetch_all_sweden_stations()
    if stations is None:
        print("! All Overpass endpoints failed, aborting", file=sys.stderr)
        return 1

    # Keep only stations with known coordinates and a recognized brand
    cleaned = [
        s for s in stations
        if s.get("lat") is not None and s.get("lng") is not None
    ]
    print(f"Fetched {len(cleaned)} stations")

    # Summary by brand
    from collections import Counter
    by_brand = Counter(s["brand"] for s in cleaned)
    print("\nBy brand:")
    for brand, count in by_brand.most_common():
        print(f"  {brand:12} {count}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "OpenStreetMap, Overpass API",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL",
        "count": len(cleaned),
        "stations": cleaned,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
