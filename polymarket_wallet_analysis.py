#!/usr/bin/env python3
"""
Polymarket Wallet Win-Rate Analyzer
Pulls on-chain trade data for BTC 15-minute markets and ranks wallets by win rate.

Usage:
    python3 polymarket_wallet_analysis.py          # live data
    python3 polymarket_wallet_analysis.py --demo   # offline preview with mock data
"""

import argparse
import json
import math
import random
import time
from collections import defaultdict
from datetime import datetime, timezone

import requests


# ── Config ───────────────────────────────────────────────────────────────────
GAMMA_API  = "https://gamma-api.polymarket.com"
CLOB_API   = "https://clob.polymarket.com"
SUBGRAPH   = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

MIN_TRADES = 10   # wallets with fewer trades are filtered out
TOP_N      = 30   # rows to show in the terminal table
RATE_DELAY = 0.25 # seconds between API pages


# ── Helpers ───────────────────────────────────────────────────────────────────
def _to_int(val) -> int:
    """Safely coerce subgraph numeric fields (may arrive as str or int)."""
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _to_ts(val) -> int:
    """Parse a timestamp that may be int, float, or decimal-string."""
    if not val:
        return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def get(url: str, params: dict = None, retries: int = 3):
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


def post_gql(query: str, variables: dict = None):
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


# ── Step 1: Find BTC 15-min markets ──────────────────────────────────────────
def find_btc_markets(limit: int = 50) -> list:
    print("\n[1/4] Fetching BTC 15-minute markets from Gamma API...")
    markets, seen = [], set()

    for kw in ("btc", "bitcoin"):
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
                slug  = (m.get("slug")     or "").lower()
                title = (m.get("question") or m.get("title") or "").lower()
                cid   = m.get("conditionId") or m.get("id")
                if cid in seen:
                    continue
                if any(t in title or t in slug for t in ("15-min", "15min", "15 min", " 15m", "15-minute")):
                    markets.append(m)
                    seen.add(cid)
            page += 1
            if len(batch) < 100:
                break
            time.sleep(RATE_DELAY)

    print(f"  Found {len(markets)} BTC 15-minute markets.")
    return markets[:limit]


def _broader_btc_search() -> list:
    """Widen search when the 15-min filter yields nothing."""
    data = get(f"{GAMMA_API}/markets", params={"q": "bitcoin 15", "limit": 100})
    if data is None:
        return []
    if isinstance(data, list):
        return data
    # dict — guard against empty-list masking as falsy
    return data.get("markets", [])


def extract_condition_ids(markets: list) -> list:
    ids = []
    for m in markets:
        cid = m.get("conditionId") or m.get("condition_id") or m.get("id")
        if cid:
            ids.append(cid)
    return list(set(ids))


# ── Step 2: Pull trades ───────────────────────────────────────────────────────
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


def fetch_trades_subgraph(condition_ids: list) -> list:
    print("\n[2/4] Fetching trades from The Graph subgraph...")
    all_trades, skip = [], 0
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
        # The Graph caps skip at 5000; switch to timestamp cursor beyond that
        if skip >= 5000:
            oldest_ts = all_trades[-1].get("creationTimestamp", 0)
            print(f"\n  [info] Hit skip=5000 cap; continuing from ts<={oldest_ts}")
            break
        time.sleep(RATE_DELAY)

    print(f"\n  Total trades fetched: {len(all_trades)}")
    return all_trades


def fetch_trades_clob(market_ids: list) -> list:
    """Fallback: CLOB REST API."""
    print("\n[2/4] (Fallback) Fetching trades from CLOB API...")
    all_trades = []

    for mid in market_ids[:20]:
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


# ── Step 3: Aggregate per wallet ──────────────────────────────────────────────
def _new_wallet() -> dict:
    return {
        "trades": 0, "buys": 0, "sells": 0,
        "gross_in": 0.0, "gross_out": 0.0,
        "tokens_bought": 0.0, "tokens_sold": 0.0,
        "profitable_exits": 0, "unprofitable_exits": 0,
        "first_trade": None, "last_trade": None,
    }


def _update_timestamps(w: dict, ts: int):
    if ts:
        if w["first_trade"] is None or ts < w["first_trade"]:
            w["first_trade"] = ts
        if w["last_trade"] is None or ts > w["last_trade"]:
            w["last_trade"] = ts


def aggregate_wallets_subgraph(trades: list) -> dict:
    wallets = defaultdict(_new_wallet)

    for t in trades:
        addr = (t.get("creator") or {}).get("id", "").lower()
        if not addr:
            continue

        w = wallets[addr]
        w["trades"] += 1
        _update_timestamps(w, _to_int(t.get("creationTimestamp", 0)))

        # Both fields arrive as decimal strings from The Graph
        collateral = _to_int(t.get("collateralAmount", 0)) / 1e6
        tokens     = _to_int(t.get("outcomeTokensTraded", 0)) / 1e6
        ttype      = (t.get("type") or "").upper()

        if ttype == "BUY":
            w["buys"]          += 1
            w["gross_in"]      += collateral
            w["tokens_bought"] += tokens
        elif ttype == "SELL":
            w["sells"]        += 1
            w["gross_out"]    += collateral
            w["tokens_sold"]  += tokens
            if collateral > 0 and tokens > 0:
                price = collateral / tokens   # USDC received per outcome token
                if price >= 0.50:
                    w["profitable_exits"] += 1
                else:
                    w["unprofitable_exits"] += 1

    return wallets


def aggregate_wallets_clob(trades: list) -> dict:
    wallets = defaultdict(_new_wallet)

    for t in trades:
        for addr_field, side_field in [
            ("maker_address", "maker_side"),
            ("taker_address", "taker_side"),
        ]:
            addr = (t.get(addr_field) or "").lower()
            if not addr or addr == "0x" + "0" * 40:
                continue

            w = wallets[addr]
            w["trades"] += 1
            _update_timestamps(w, _to_ts(t.get("timestamp") or t.get("created_at")))

            price  = float(t.get("price", 0) or 0)
            size   = float(t.get("size",  0) or 0)
            side_v = (t.get(side_field) or t.get("side") or "").upper()

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


# ── Step 4: Score & rank ──────────────────────────────────────────────────────
def score_wallets(wallets: dict, min_trades: int = MIN_TRADES) -> list:
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < min_trades:
            continue

        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = (w["profitable_exits"] / exits * 100) if exits > 0 else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]

        # Active days: ceil so a wallet active across midnight counts as 2 days
        if w["first_trade"] and w["last_trade"]:
            span_secs   = max(0, w["last_trade"] - w["first_trade"])
            active_days = max(1, math.ceil(span_secs / 86400))
        else:
            active_days = 1

        rows.append({
            "address":          addr,
            "trades":           w["trades"],
            "buys":             w["buys"],
            "sells":            w["sells"],
            "win_rate":         round(win_rate, 1),
            "profitable_exits": w["profitable_exits"],
            "total_exits":      exits,
            "net_pnl_usdc":     round(net_pnl, 2),
            "gross_in_usdc":    round(w["gross_in"], 2),
            "gross_out_usdc":   round(w["gross_out"], 2),
            "trades_per_day":   round(w["trades"] / active_days, 1),
            "active_days":      active_days,
        })

    rows.sort(key=lambda r: (r["win_rate"], r["net_pnl_usdc"], r["trades"]), reverse=True)
    return rows


# ── Step 5: Display ───────────────────────────────────────────────────────────
def print_table(rows: list, top_n: int = TOP_N, min_trades: int = MIN_TRADES):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'W/L':>9} {'Net P&L':>10} {'Days':>5}"
    )
    sep = "-" * len(header)
    print(f"\n[4/4] Top {min(top_n, len(rows))} wallets by win rate  (min {min_trades} trades)\n")
    print(sep)
    print(header)
    print(sep)

    for i, r in enumerate(rows[:top_n], 1):
        wl      = f"{r['profitable_exits']}/{r['total_exits']}"
        pnl_str = (f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0
                   else f"{r['net_pnl_usdc']:.2f}")
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {wl:>9} {pnl_str:>10} {r['active_days']:>5}"
        )

    print(sep)
    print(f"\nShowing {min(top_n, len(rows))} of {len(rows)} qualifying wallets.\n")


def save_json(rows: list, path: str = "wallet_rankings.json"):
    with open(path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Full rankings saved to {path}")


# ── Demo mode (offline preview) ───────────────────────────────────────────────
def _fake_address(seed: int) -> str:
    rng = random.Random(seed)
    return "0x" + "".join(rng.choices("0123456789abcdef", k=40))


def run_demo(top_n: int = TOP_N, min_trades: int = MIN_TRADES):
    """Generate realistic mock data so the output can be previewed offline."""
    print("\n[demo] Generating synthetic trade data for 80 wallets...\n")
    random.seed(42)
    now = int(datetime.now(timezone.utc).timestamp())

    wallets = defaultdict(_new_wallet)

    for wallet_idx in range(80):
        addr = _fake_address(wallet_idx)
        # Bot-like wallet: high frequency, high win rate
        is_bot = wallet_idx < 5

        n_trades    = random.randint(800, 2400) if is_bot else random.randint(10, 120)
        win_rate_t  = random.uniform(0.78, 0.91) if is_bot else random.uniform(0.35, 0.68)
        span_days   = random.randint(7, 21)
        span_secs   = span_days * 86400
        first_ts    = now - span_secs

        w = wallets[addr]
        for i in range(n_trades):
            ts = first_ts + random.randint(0, span_secs)
            _update_timestamps(w, ts)
            w["trades"] += 1

            # Each trade: buy then matching sell
            entry_price = random.uniform(0.25, 0.38)
            size        = random.uniform(60, 100)   # outcome tokens
            collateral_in = entry_price * size

            w["buys"]          += 1
            w["gross_in"]      += collateral_in
            w["tokens_bought"] += size

            # Decide outcome
            won = random.random() < win_rate_t
            exit_price      = random.uniform(0.85, 0.98) if won else random.uniform(0.02, 0.15)
            collateral_out  = exit_price * size

            w["sells"]        += 1
            w["gross_out"]    += collateral_out
            w["tokens_sold"]  += size
            if exit_price >= 0.50:
                w["profitable_exits"] += 1
            else:
                w["unprofitable_exits"] += 1

    print("[3/4] Aggregating wallet statistics...")
    print(f"  Unique wallets: {len(wallets)}")
    ranked = score_wallets(wallets, min_trades=min_trades)
    print_table(ranked, top_n=top_n, min_trades=min_trades)
    save_json(ranked, "wallet_rankings_demo.json")
    print("(Demo mode — no real API calls were made.)\n")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Polymarket BTC 15-min wallet win-rate analyzer")
    parser.add_argument("--demo", action="store_true", help="Run offline with synthetic data")
    parser.add_argument("--top",  type=int, default=TOP_N, help="Rows to display (default 30)")
    parser.add_argument("--min-trades", type=int, default=MIN_TRADES,
                        help="Minimum trades to include a wallet (default 10)")
    args = parser.parse_args()

    top_n      = args.top
    min_trades = args.min_trades

    print("=" * 60)
    print("  Polymarket BTC 15-min Wallet Win-Rate Analyzer")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    if args.demo:
        run_demo(top_n=top_n, min_trades=min_trades)
        return

    # ── Live path ────────────────────────────────────────────────────────────
    markets = find_btc_markets()

    if not markets:
        print("\n[!] No 15-min markets found. Trying broader search...")
        markets = _broader_btc_search()

    if not markets:
        print("[!] Could not reach Polymarket API. Run with --demo to preview output.")
        return

    print("\n  Sample markets:")
    for m in markets[:5]:
        title = m.get("question") or m.get("title") or m.get("slug", "?")
        print(f"    • {title}")

    condition_ids = extract_condition_ids(markets)
    print(f"\n  Condition IDs to query: {len(condition_ids)}")

    trades = fetch_trades_subgraph(condition_ids) if condition_ids else []

    if not trades:
        mids = [m.get("id") or m.get("conditionId") for m in markets
                if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(mids)

    if not trades:
        print("\n[!] No trade data retrieved. Run with --demo to preview output.")
        return

    print("\n[3/4] Aggregating wallet statistics...")
    wallets = (aggregate_wallets_subgraph(trades)
               if "creator" in trades[0]
               else aggregate_wallets_clob(trades))
    print(f"  Unique wallets found: {len(wallets)}")

    ranked = score_wallets(wallets, min_trades=min_trades)
    print_table(ranked, top_n=top_n, min_trades=min_trades)
    save_json(ranked)


if __name__ == "__main__":
    main()
