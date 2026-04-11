"""
OpenStreetMap Overpass API, real fuel station locations.

Provides a list of every `amenity=fuel` in Sweden with coordinates,
operator, brand, and opening hours (when tagged). This is how we go
from 158 procedurally-placed demo stations to the ~3000+ real
stations that actually exist in Sweden.

The data is licensed under ODbL. Attribution "© OpenStreetMap
contributors" is shown in the UI.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ._http import http_get


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

QUERY = """
[out:json][timeout:120];
area["ISO3166-1"="SE"][admin_level=2]->.se;
(
  node["amenity"="fuel"](area.se);
  way["amenity"="fuel"](area.se);
);
out center tags;
"""


def fetch_all_sweden_stations() -> Optional[List[Dict[str, Any]]]:
    """Fetches every fuel station in Sweden from OpenStreetMap.

    Returns a list of stations like:
        [
          {
            "osm_id": 123456,
            "osm_type": "node",
            "lat": 59.3293,
            "lng": 18.0686,
            "brand": "Circle K",
            "operator": "Couche-Tard AB",
            "name": "Circle K Vasastan",
            "city": "Stockholm",
            "address": "Sveavägen 1",
            "opening_hours": "24/7",
            "services": ["car_wash", "convenience"],
          },
          ...
        ]
    """
    for endpoint in OVERPASS_ENDPOINTS:
        payload = http_get(
            f"{endpoint}?data={QUERY.strip()}",
            timeout=180,
            accept="application/json",
        )
        if not payload:
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        return [_convert(el) for el in data.get("elements", [])]
    return None


def _convert(element: Dict[str, Any]) -> Dict[str, Any]:
    tags = element.get("tags") or {}
    if element.get("type") == "node":
        lat, lng = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        lat, lng = center.get("lat"), center.get("lon")

    brand = (
        tags.get("brand")
        or tags.get("operator")
        or tags.get("name", "").split()[0]
        or "Okänd"
    )
    # Normalize brand names so they match our 8 canonical brands
    BRAND_ALIASES = {
        "Circle K":    ["Circle K", "Circle-K", "Statoil"],
        "OKQ8":        ["OKQ8", "OK-Q8", "OK Q8", "Q8"],
        "Preem":       ["Preem", "Preemraff"],
        "Shell":       ["Shell"],
        "St1":         ["St1", "ST1", "St 1"],
        "Ingo":        ["Ingo", "INGO"],
        "Tanka":       ["Tanka"],
        "Qstar":       ["Qstar", "QStar", "Q-Star"],
    }
    brand_norm = "Okänd"
    for canonical, aliases in BRAND_ALIASES.items():
        if any(a.lower() in brand.lower() for a in aliases):
            brand_norm = canonical
            break

    services = []
    if tags.get("car_wash") == "yes":
        services.append("biltvätt")
    if tags.get("shop") in ("convenience", "yes"):
        services.append("butik")
    if tags.get("amenity:toilets") == "yes" or tags.get("toilets") == "yes":
        services.append("toalett")
    if tags.get("compressed_air") == "yes":
        services.append("tryckluft")

    return {
        "osm_id": element.get("id"),
        "osm_type": element.get("type"),
        "lat": lat,
        "lng": lng,
        "brand": brand_norm,
        "brand_raw": brand,
        "operator": tags.get("operator"),
        "name": tags.get("name") or f"{brand_norm} station",
        "city": tags.get("addr:city"),
        "address": " ".join(
            filter(
                None,
                [tags.get("addr:street"), tags.get("addr:housenumber")],
            )
        )
        or None,
        "opening_hours": tags.get("opening_hours"),
        "open_24_7": tags.get("opening_hours") == "24/7",
        "services": services,
    }
