#!/usr/bin/env python3
"""
Polymarket Wallet Win-Rate Analyzer
Pulls on-chain trade data for BTC 15-minute markets and ranks wallets by win rate.
"""

import requests
import json
import time
from collections import defaultdict
from datetime import datetime, timezone


# ── Config ──────────────────────────────────────────────────────────────────
GAMMA_API   = "https://gamma-api.polymarket.com"
CLOB_API    = "https://clob.polymarket.com"
SUBGRAPH    = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

# Minimum trades to be included in rankings (filters noise)
MIN_TRADES  = 10
# How many top wallets to display
TOP_N       = 30
# Request delay (seconds) — be polite to public APIs
RATE_DELAY  = 0.25


# ── Helpers ──────────────────────────────────────────────────────────────────
def get(url: str, params: dict = None, retries: int = 3) -> dict | list | None:
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  [warn] GET {url} failed: {e}")
                return None


def post_gql(query: str, variables: dict = None) -> dict | None:
    payload = {"query": query, "variables": variables or {}}
    for attempt in range(3):
        try:
            r = requests.post(SUBGRAPH, json=payload, timeout=20)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                print(f"  [warn] GraphQL query failed: {e}")
                return None


# ── Step 1: Find BTC 15-min markets ─────────────────────────────────────────
def find_btc_markets(limit: int = 50) -> list[dict]:
    """Search Gamma API for BTC 15-minute markets."""
    print("\n[1/4] Fetching BTC 15-minute markets from Gamma API...")

    keywords = ["btc", "bitcoin"]
    markets  = []
    seen     = set()

    for kw in keywords:
        page = 0
        while True:
            data = get(
                f"{GAMMA_API}/markets",
                params={"q": kw, "closed": "false", "limit": 100, "offset": page * 100},
            )
            if not data:
                break
            batch = data if isinstance(data, list) else data.get("markets", [])
            if not batch:
                break

            for m in batch:
                slug  = (m.get("slug") or "").lower()
                title = (m.get("question") or m.get("title") or "").lower()
                cid   = m.get("conditionId") or m.get("id")
                if cid in seen:
                    continue
                # Keep only 15-minute / short-window BTC markets
                if any(tag in title or tag in slug for tag in ["15", "15-min", "15min", "15 min"]):
                    markets.append(m)
                    seen.add(cid)

            page += 1
            if len(batch) < 100:
                break
            time.sleep(RATE_DELAY)

    print(f"  Found {len(markets)} BTC 15-minute markets.")
    return markets[:limit]


# ── Step 2: Resolve condition IDs ────────────────────────────────────────────
def extract_condition_ids(markets: list[dict]) -> list[str]:
    ids = []
    for m in markets:
        cid = m.get("conditionId") or m.get("condition_id") or m.get("id")
        if cid:
            ids.append(cid)
    return list(set(ids))


# ── Step 3: Pull trades from The Graph ──────────────────────────────────────
GQL_TRADES = """
query Trades($conditions: [String!]!, $skip: Int!) {
  fpmmTrades(
    first: 1000
    skip: $skip
    where: { fpmm_in: $conditions }
    orderBy: creationTimestamp
    orderDirection: desc
  ) {
    id
    type
    creator { id }
    fpmm { id }
    outcomeIndex
    outcomeTokensTraded
    collateralAmount
    feeAmount
    creationTimestamp
  }
}
"""

def fetch_trades_subgraph(condition_ids: list[str]) -> list[dict]:
    """Fetch all trades for the given market IDs via The Graph."""
    print("\n[2/4] Fetching trades from The Graph subgraph...")
    all_trades = []
    skip       = 0
    batch_size = 1000

    while True:
        result = post_gql(GQL_TRADES, {"conditions": condition_ids, "skip": skip})
        if not result:
            break
        trades = result.get("data", {}).get("fpmmTrades", [])
        if not trades:
            break
        all_trades.extend(trades)
        print(f"  Fetched {len(all_trades)} trades so far...", end="\r")
        if len(trades) < batch_size:
            break
        skip += batch_size
        time.sleep(RATE_DELAY)

    print(f"\n  Total trades fetched: {len(all_trades)}")
    return all_trades


# ── Fallback: CLOB API trades ────────────────────────────────────────────────
def fetch_trades_clob(market_ids: list[str]) -> list[dict]:
    """Fallback: fetch trades from the CLOB REST API."""
    print("\n[2/4] (Fallback) Fetching trades from CLOB API...")
    all_trades = []

    for mid in market_ids[:20]:            # cap to avoid hammering the API
        cursor = ""
        while True:
            params = {"market": mid, "limit": 500}
            if cursor:
                params["cursor"] = cursor
            data = get(f"{CLOB_API}/trades", params=params)
            if not data:
                break
            trades = data if isinstance(data, list) else data.get("data", [])
            if not trades:
                break
            for t in trades:
                t["_market"] = mid
            all_trades.extend(trades)
            cursor = data.get("next_cursor", "") if isinstance(data, dict) else ""
            if not cursor:
                break
            time.sleep(RATE_DELAY)

    print(f"  Total trades (CLOB): {len(all_trades)}")
    return all_trades


# ── Step 4: Aggregate per wallet ─────────────────────────────────────────────
def aggregate_wallets_subgraph(trades: list[dict]) -> dict[str, dict]:
    """
    From subgraph trades build per-wallet stats.

    A 'Buy' trade is a win if it resolves YES (outcomeIndex=0 for Yes contracts).
    Since we can't always know resolution here, we track:
      - net P&L via collateralAmount (USDC, 6 decimals) vs outcomeTokensTraded
      - a position as profitable if outcomeTokensTraded > collateralAmount (paid less than received)
    """
    wallets: dict[str, dict] = defaultdict(lambda: {
        "trades": 0,
        "buys": 0,
        "sells": 0,
        "gross_in":   0.0,   # USDC spent on buys
        "gross_out":  0.0,   # USDC received on sells
        "tokens_bought": 0.0,
        "tokens_sold":   0.0,
        "profitable_exits": 0,
        "unprofitable_exits": 0,
        "first_trade": None,
        "last_trade":  None,
    })

    for t in trades:
        addr = (t.get("creator") or {}).get("id", "").lower()
        if not addr:
            continue

        w = wallets[addr]
        w["trades"] += 1

        ts = int(t.get("creationTimestamp", 0))
        if w["first_trade"] is None or ts < w["first_trade"]:
            w["first_trade"] = ts
        if w["last_trade"] is None or ts > w["last_trade"]:
            w["last_trade"] = ts

        collateral = int(t.get("collateralAmount", 0)) / 1e6    # USDC 6 dec
        tokens     = int(t.get("outcomeTokensTraded", 0)) / 1e6
        trade_type = t.get("type", "").upper()

        if trade_type == "BUY":
            w["buys"]        += 1
            w["gross_in"]    += collateral
            w["tokens_bought"] += tokens
        elif trade_type == "SELL":
            w["sells"]        += 1
            w["gross_out"]    += collateral
            w["tokens_sold"]  += tokens
            # A sell is profitable if we received more USDC per token than we paid
            # Approximate: sell collateral > average buy cost
            if collateral > 0:
                if tokens > 0:
                    price = collateral / tokens      # received per token
                    w["profitable_exits"]   += (1 if price >= 0.50 else 0)
                    w["unprofitable_exits"] += (0 if price >= 0.50 else 1)

    return wallets


def aggregate_wallets_clob(trades: list[dict]) -> dict[str, dict]:
    """Aggregate CLOB API trade records."""
    wallets: dict[str, dict] = defaultdict(lambda: {
        "trades": 0,
        "buys": 0,
        "sells": 0,
        "gross_in":  0.0,
        "gross_out": 0.0,
        "tokens_bought": 0.0,
        "tokens_sold":   0.0,
        "profitable_exits": 0,
        "unprofitable_exits": 0,
        "first_trade": None,
        "last_trade":  None,
    })

    for t in trades:
        # CLOB fields vary; try both maker/taker sides
        for side, addr_field in [("maker", "maker_address"), ("taker", "taker_address")]:
            addr = (t.get(addr_field) or "").lower()
            if not addr or addr == "0x0000000000000000000000000000000000000000":
                continue

            w = wallets[addr]
            w["trades"] += 1

            ts_raw = t.get("timestamp") or t.get("created_at") or 0
            ts = int(ts_raw) if str(ts_raw).isdigit() else 0
            if ts:
                if w["first_trade"] is None or ts < w["first_trade"]:
                    w["first_trade"] = ts
                if w["last_trade"] is None or ts > w["last_trade"]:
                    w["last_trade"] = ts

            price  = float(t.get("price",  0) or 0)
            size   = float(t.get("size",   0) or 0)
            side_v = (t.get(f"{side}_side") or t.get("side") or "").upper()

            if side_v == "BUY":
                w["buys"]          += 1
                w["gross_in"]      += price * size
                w["tokens_bought"] += size
            elif side_v == "SELL":
                w["sells"]          += 1
                w["gross_out"]      += price * size
                w["tokens_sold"]    += size
                if price >= 0.50:
                    w["profitable_exits"] += 1
                else:
                    w["unprofitable_exits"] += 1

    return wallets


# ── Step 5: Score & rank ──────────────────────────────────────────────────────
def score_wallets(wallets: dict[str, dict]) -> list[dict]:
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < MIN_TRADES:
            continue

        exits = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = (w["profitable_exits"] / exits * 100) if exits > 0 else 0.0

        net_pnl = w["gross_out"] - w["gross_in"]

        # Active days
        active_days = 1
        if w["first_trade"] and w["last_trade"]:
            span = w["last_trade"] - w["first_trade"]
            active_days = max(1, span // 86400)

        trades_per_day = w["trades"] / active_days

        rows.append({
            "address":         addr,
            "trades":          w["trades"],
            "buys":            w["buys"],
            "sells":           w["sells"],
            "win_rate":        round(win_rate, 1),
            "profitable_exits": w["profitable_exits"],
            "total_exits":     exits,
            "net_pnl_usdc":    round(net_pnl, 2),
            "gross_in_usdc":   round(w["gross_in"], 2),
            "gross_out_usdc":  round(w["gross_out"], 2),
            "trades_per_day":  round(trades_per_day, 1),
            "active_days":     active_days,
        })

    # Sort: win_rate desc, then net_pnl desc, then trades desc
    rows.sort(key=lambda r: (r["win_rate"], r["net_pnl_usdc"], r["trades"]), reverse=True)
    return rows


# ── Step 6: Pretty-print ──────────────────────────────────────────────────────
def print_table(rows: list[dict], top_n: int = TOP_N):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'W/L':>9} {'Net P&L':>10} {'Days':>5}"
    )
    sep = "-" * len(header)
    print(f"\n[4/4] Top {top_n} wallets by win rate (min {MIN_TRADES} trades)\n")
    print(sep)
    print(header)
    print(sep)

    for i, r in enumerate(rows[:top_n], 1):
        wl = f"{r['profitable_exits']}/{r['total_exits']}"
        pnl_str = f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0 else f"{r['net_pnl_usdc']:.2f}"
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {wl:>9} {pnl_str:>10} {r['active_days']:>5}"
        )

    print(sep)
    print(f"\nShowing {min(top_n, len(rows))} of {len(rows)} wallets with >= {MIN_TRADES} trades.\n")


def save_json(rows: list[dict], path: str = "wallet_rankings.json"):
    with open(path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Full rankings saved to {path}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  Polymarket BTC 15-min Wallet Win-Rate Analyzer")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # 1. Find markets
    markets = find_btc_markets()

    if not markets:
        print("\n[!] No BTC 15-minute markets found. Trying a broader search...")
        # Widen to any BTC market so we still get data
        data = get(f"{GAMMA_API}/markets", params={"q": "bitcoin 15", "limit": 100})
        markets = data if isinstance(data, list) else (data or {}).get("markets", [])

    if not markets:
        print("[!] Could not find any relevant markets. Exiting.")
        return

    print(f"\n  Sample markets:")
    for m in markets[:5]:
        title = m.get("question") or m.get("title") or m.get("slug", "?")
        print(f"    • {title}")

    condition_ids = extract_condition_ids(markets)
    print(f"\n  Condition IDs to query: {len(condition_ids)}")

    # 2. Fetch trades
    trades = []
    if condition_ids:
        trades = fetch_trades_subgraph(condition_ids)

    # Fallback to CLOB if subgraph returned nothing
    if not trades:
        market_ids = [m.get("id") or m.get("conditionId") for m in markets if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(market_ids)

    if not trades:
        print("\n[!] No trade data retrieved. The markets may be very new or the APIs are unavailable.")
        return

    # 3. Aggregate
    print("\n[3/4] Aggregating wallet statistics...")
    # Detect which schema we have
    if trades and "creator" in trades[0]:
        wallets = aggregate_wallets_subgraph(trades)
    else:
        wallets = aggregate_wallets_clob(trades)

    print(f"  Unique wallets found: {len(wallets)}")

    # 4. Rank and display
    ranked = score_wallets(wallets)
    print_table(ranked)
    save_json(ranked)


if __name__ == "__main__":
    main()
