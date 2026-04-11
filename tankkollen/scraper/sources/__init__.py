"""
Tankkollen price data sources.

Each module exposes one or more functions that return a dict of the form:

    {
        "<Brand name>": {
            "bensin95": 17.89 | None,
            "bensin98": 18.79 | None,
            "diesel":   17.49 | None,
            "hvo100":   22.95 | None,
            "e85":      13.69 | None,
            "ad-blue":  14.50 | None,
        },
        ...
    }

or, for aggregator/national sources, a dict like:

    {
        "meta": {"source": "...", "as_of": "ISO-date"},
        "national_avg": {"bensin95": 17.9, "diesel": 17.4, ...},
        "cheapest_reported": [
            {"brand": "Ingo", "city": "Stockholm", "bensin95": 16.79},
            ...
        ],
    }

Every source MUST return `None` rather than raise on any failure
(network, parse, etc.) so the orchestrator can cleanly fall back.
"""
