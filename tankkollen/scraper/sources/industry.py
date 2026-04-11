"""
Industry / government statistics sources.

These scrapers pull aggregated price data from neutral, authoritative
bodies, useful for computing the national average, tracking trends,
and building confidence intervals around crowdsourced prices.
"""

from __future__ import annotations

import re
from typing import Dict, Optional

from ._http import http_get, parse_price


# ---------------------------------------------------------------------------
# Drivkraft Sverige, the Swedish fuel industry association
# ---------------------------------------------------------------------------

def scrape_drivkraft_sverige() -> Optional[Dict]:
    """Scrapes Drivkraft Sverige's price page.

    Drivkraft publishes weekly average recommended prices for each
    fuel type (list prices before discounts), which is what most
    Swedes see at the pump before they flash their loyalty app.
    """
    urls = [
        "https://drivkraftsverige.se/priser-skatter/drivmedelspriser/",
        "https://drivkraftsverige.se/siffror-och-statistik/priser-skatter/drivmedelspriser/",
    ]
    html = None
    for url in urls:
        html = http_get(url)
        if html:
            break
    if not html:
        return None

    national_avg: Dict[str, Optional[float]] = {}
    labels = {
        "bensin95": [r"Bensin\s*95", r"95-oktanig", r"95\s*oktan"],
        "bensin98": [r"Bensin\s*98", r"98-oktanig", r"98\s*oktan"],
        "diesel":   [r"Diesel(?:\s*MK\s*1)?"],
        "hvo100":   [r"HVO\s*100"],
        "e85":      [r"E\s*85", r"Etanol"],
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
            "source": "Drivkraft Sverige (branschstatistik)",
            "url": "https://drivkraftsverige.se/priser-skatter/drivmedelspriser/",
        },
        "national_avg": national_avg,
    }


# ---------------------------------------------------------------------------
# SCB, Statistikmyndigheten (fuel price index)
# ---------------------------------------------------------------------------

def scrape_scb_fuel_index() -> Optional[Dict]:
    """Attempts to fetch SCB's monthly fuel price index.

    SCB publishes price data in CSV / PxWeb JSON but this parser just
    tries to pull the latest monthly figures from the summary page.
    """
    html = http_get(
        "https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-konsumtion/"
        "konsumentprisindex/konsumentprisindex-kpi/pong/statistiknyhet/"
    )
    if not html:
        return None
    # Best-effort: look for a recent fuel-price change percentage
    m = re.search(
        r"(bensin|diesel|drivmedel)[^.]*?(sjönk|steg|minskade|ökade)[^.]*?"
        r"(\d+[,.]\d+)\s*%",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return None
    return {
        "meta": {
            "source": "SCB Konsumentprisindex (KPI)",
            "url": "https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-konsumtion/",
        },
        "monthly_change": {
            "fuel": m.group(1).lower(),
            "direction": m.group(2).lower(),
            "pct": parse_price(m.group(3)),
        },
    }


INDUSTRY_SOURCES = {
    "drivkraft": scrape_drivkraft_sverige,
    "scb":       scrape_scb_fuel_index,
}
