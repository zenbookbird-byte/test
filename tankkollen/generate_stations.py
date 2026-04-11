#!/usr/bin/env python3
"""Generates a realistic dataset of Swedish fuel stations for Tankkollen."""
import json
import random
import math

random.seed(42)

# Real Swedish city centers with population weighting
CITIES = [
    ("Stockholm", 59.3293, 18.0686, 16),
    ("Göteborg", 57.7089, 11.9746, 12),
    ("Malmö", 55.6050, 13.0038, 10),
    ("Uppsala", 59.8586, 17.6389, 6),
    ("Västerås", 59.6099, 16.5448, 5),
    ("Örebro", 59.2753, 15.2134, 5),
    ("Linköping", 58.4108, 15.6214, 5),
    ("Helsingborg", 56.0465, 12.6945, 5),
    ("Jönköping", 57.7826, 14.1618, 5),
    ("Norrköping", 58.5877, 16.1924, 4),
    ("Lund", 55.7047, 13.1910, 4),
    ("Umeå", 63.8258, 20.2630, 4),
    ("Gävle", 60.6749, 17.1413, 4),
    ("Borås", 57.7210, 12.9401, 4),
    ("Sundsvall", 62.3908, 17.3069, 4),
    ("Eskilstuna", 59.3717, 16.5079, 3),
    ("Halmstad", 56.6745, 12.8578, 3),
    ("Växjö", 56.8777, 14.8091, 3),
    ("Karlstad", 59.4022, 13.5115, 4),
    ("Luleå", 65.5848, 22.1567, 3),
    ("Kalmar", 56.6616, 16.3616, 3),
    ("Östersund", 63.1792, 14.6357, 3),
    ("Trollhättan", 58.2837, 12.2886, 3),
    ("Karlskrona", 56.1612, 15.5869, 3),
    ("Kristianstad", 56.0294, 14.1567, 3),
    ("Skövde", 58.3911, 13.8454, 3),
    ("Skellefteå", 64.7507, 20.9528, 3),
    ("Uddevalla", 58.3498, 11.9423, 2),
    ("Motala", 58.5373, 15.0429, 2),
    ("Falun", 60.6065, 15.6355, 3),
    ("Borlänge", 60.4858, 15.4371, 2),
    ("Nyköping", 58.7528, 17.0078, 2),
    ("Visby", 57.6348, 18.2948, 2),
    ("Örnsköldsvik", 63.2884, 18.7157, 2),
    ("Piteå", 65.3172, 21.4791, 2),
    ("Kiruna", 67.8558, 20.2253, 1),
    ("Haparanda", 65.8354, 24.1367, 1),
    ("Ystad", 55.4297, 13.8204, 2),
    ("Hudiksvall", 61.7282, 17.1060, 2),
    ("Härnösand", 62.6323, 17.9379, 2),
    ("Mora", 61.0089, 14.5397, 1),
    ("Sälen", 61.1643, 13.2671, 1),
    ("Åre", 63.3988, 13.0815, 1),
]

# Swedish gas station brands with characteristics
BRANDS = [
    {
        "name": "Circle K",
        "slug": "circle-k",
        "color": "#EE2E24",
        "logo": "CK",
        "price_mod": 0.05,  # slightly above average
        "types": ["bensin95", "bensin98", "diesel", "hvo100", "ad-blue"],
    },
    {
        "name": "OKQ8",
        "slug": "okq8",
        "color": "#E4002B",
        "logo": "OK",
        "price_mod": 0.02,
        "types": ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"],
    },
    {
        "name": "Preem",
        "slug": "preem",
        "color": "#00843D",
        "logo": "P",
        "price_mod": 0.0,
        "types": ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"],
    },
    {
        "name": "Shell",
        "slug": "shell",
        "color": "#FFD500",
        "logo": "S",
        "price_mod": 0.08,  # premium brand
        "types": ["bensin95", "bensin98", "diesel", "hvo100"],
    },
    {
        "name": "St1",
        "slug": "st1",
        "color": "#E30613",
        "logo": "St1",
        "price_mod": 0.01,
        "types": ["bensin95", "bensin98", "diesel", "hvo100", "e85"],
    },
    {
        "name": "Ingo",
        "slug": "ingo",
        "color": "#F59E0B",
        "logo": "In",
        "price_mod": -0.12,  # discount unmanned
        "types": ["bensin95", "diesel"],
    },
    {
        "name": "Tanka",
        "slug": "tanka",
        "color": "#0EA5E9",
        "logo": "T",
        "price_mod": -0.08,
        "types": ["bensin95", "bensin98", "diesel", "e85"],
    },
    {
        "name": "Qstar",
        "slug": "qstar",
        "color": "#7C3AED",
        "logo": "Q",
        "price_mod": -0.05,
        "types": ["bensin95", "diesel", "e85"],
    },
]

# Base fuel prices (SEK/liter) as of April 2026 (realistic recent-era)
BASE_PRICES = {
    "bensin95": 17.89,
    "bensin98": 18.79,
    "diesel": 17.49,
    "hvo100": 22.95,
    "e85": 13.69,
    "ad-blue": 14.50,
}

# Street/location name patterns
STREETS = [
    "Storgatan", "Kungsgatan", "Drottninggatan", "Norra Vägen", "Södra Vägen",
    "Industrivägen", "Hamnvägen", "E4 Norra", "E4 Södra", "E6 Norra", "E6 Södra",
    "Ringvägen", "Köpmangatan", "Järnvägsgatan", "Centralgatan", "Västra Vägen",
    "Östra Vägen", "Trafikplats Norr", "Trafikplats Söder", "Torggatan",
    "Vallgatan", "Fabriksgatan", "Bangårdsgatan", "Sveavägen", "Strandvägen",
]


def offset_coord(lat, lng, max_km=8):
    """Random offset in km from a point."""
    # 1 degree lat ~111 km, 1 deg lng ~ 111*cos(lat)
    km_per_deg_lat = 111.0
    km_per_deg_lng = 111.0 * math.cos(math.radians(lat))
    dlat_km = random.uniform(-max_km, max_km)
    dlng_km = random.uniform(-max_km, max_km)
    return (
        lat + dlat_km / km_per_deg_lat,
        lng + dlng_km / km_per_deg_lng,
    )


def compute_prices(brand, seed_offset):
    """Computes station prices with realistic variance."""
    prices = {}
    for fuel_type in brand["types"]:
        base = BASE_PRICES[fuel_type]
        # Brand modifier + station-level variance
        station_variance = random.uniform(-0.25, 0.35)
        regional = random.uniform(-0.15, 0.15)
        price = base + brand["price_mod"] + station_variance + regional
        # Round to 2 decimals (Swedish fuel is usually priced with 2 decimals)
        prices[fuel_type] = round(price, 2)

        # Trend (price change from yesterday)
        trend = random.choice([-0.04, -0.02, -0.01, 0, 0, 0.01, 0.02, 0.03, 0.05])
        prices[f"{fuel_type}_trend"] = trend
    return prices


def generate():
    stations = []
    station_id = 1
    for city_name, lat, lng, count in CITIES:
        for _ in range(count):
            brand = random.choice(BRANDS)
            slat, slng = offset_coord(lat, lng, max_km=6)
            street = random.choice(STREETS)
            number = random.randint(1, 140)
            address = f"{street} {number}"
            prices = compute_prices(brand, station_id)
            station = {
                "id": station_id,
                "brand": brand["name"],
                "brandSlug": brand["slug"],
                "brandColor": brand["color"],
                "brandLogo": brand["logo"],
                "name": f"{brand['name']} {city_name} {street.split()[0]}",
                "city": city_name,
                "address": address,
                "lat": round(slat, 5),
                "lng": round(slng, 5),
                "open24h": random.random() < 0.55,
                "services": random.sample(
                    ["biltvätt", "butik", "café", "lufttryck", "dammsugare",
                     "tryckluft", "toalett", "snabbladdning"],
                    k=random.randint(2, 5),
                ),
                "rating": round(random.uniform(3.4, 4.9), 1),
                "reviewCount": random.randint(12, 480),
                "updatedMinutesAgo": random.randint(1, 58),
                "prices": prices,
            }
            stations.append(station)
            station_id += 1

    return stations


if __name__ == "__main__":
    stations = generate()
    print(f"Generated {len(stations)} stations across {len(CITIES)} cities")
    with open("js/stations.js", "w", encoding="utf-8") as f:
        f.write("// Tankkollen - Swedish fuel station dataset\n")
        f.write("// Auto-generated. Demo data based on realistic recent-era prices.\n")
        f.write("// Structure allows drop-in replacement with live API data.\n\n")
        f.write("window.STATIONS_DATA = ")
        json.dump(stations, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    print("Written js/stations.js")
