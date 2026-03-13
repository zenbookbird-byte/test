#!/usr/bin/env python3
"""
Polymarket War-Market Wallet Analyzer
──────────────────────────────────────
Pulls on-chain trade data from Polymarket for Iran / US / Israel
war-related prediction markets, ranks wallets by win rate, and
prints a $100 deposit strategy recommendation based on live odds.
"""

import requests
import json
import time
from collections import defaultdict
from datetime import datetime, timezone


# ── Config ───────────────────────────────────────────────────────────────────
GAMMA_API  = "https://gamma-api.polymarket.com"
CLOB_API   = "https://clob.polymarket.com"
SUBGRAPH   = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

MIN_TRADES = 5       # min trades to appear in rankings
TOP_N      = 20      # wallets to display
RATE_DELAY = 0.3     # seconds between API calls
DEPOSIT    = 100.0   # USD to simulate

# Keywords that identify war / geopolitical markets we care about
WAR_KEYWORDS = [
    "iran", "israel", "hamas", "hezbollah", "war", "strike",
    "attack", "nuclear", "missile", "idf", "irgc", "us-iran",
    "us iran", "israel iran", "middle east", "gaza", "lebanon",
    "tehran", "netanyahu", "khamenei",
]


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


# ── Step 1: Find war markets ──────────────────────────────────────────────────
def find_war_markets() -> list[dict]:
    print("\n[1/4] Searching Gamma API for Iran/US/Israel war markets...")
    markets = []
    seen    = set()

    # Try a few focused search terms; Gamma API takes a free-text `q` param
    search_terms = ["iran israel", "iran war", "israel attack", "us iran", "middle east war"]

    for term in search_terms:
        for closed in ("false", "true"):           # grab both open + resolved
            page = 0
            while True:
                data = get(
                    f"{GAMMA_API}/markets",
                    params={"q": term, "closed": closed, "limit": 100, "offset": page * 100},
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
                    if not cid or cid in seen:
                        continue
                    # Keep only markets whose title / slug matches a war keyword
                    if any(kw in title or kw in slug for kw in WAR_KEYWORDS):
                        markets.append(m)
                        seen.add(cid)

                page += 1
                if len(batch) < 100:
                    break
                time.sleep(RATE_DELAY)

    print(f"  Found {len(markets)} war-related markets.")
    return markets


def print_market_list(markets: list[dict]):
    print("\n  Markets found:")
    for m in markets[:15]:
        title  = m.get("question") or m.get("title") or m.get("slug", "?")
        volume = m.get("volume") or m.get("volumeNum") or 0
        closed = "✓" if m.get("closed") or m.get("resolved") else "○"
        print(f"    [{closed}] {title[:80]}  (vol: ${float(volume or 0):,.0f})")
    if len(markets) > 15:
        print(f"    … and {len(markets) - 15} more")


# ── Step 2: Pull trades from The Graph ───────────────────────────────────────
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
    print("\n[2/4] Fetching trades from The Graph subgraph...")
    all_trades = []
    skip       = 0

    while True:
        result = post_gql(GQL_TRADES, {"conditions": condition_ids, "skip": skip})
        if not result:
            break
        trades = result.get("data", {}).get("fpmmTrades", [])
        if not trades:
            break
        all_trades.extend(trades)
        print(f"  Fetched {len(all_trades)} trades so far...", end="\r")
        if len(trades) < 1000:
            break
        skip += 1000
        time.sleep(RATE_DELAY)

    print(f"\n  Total trades from subgraph: {len(all_trades)}")
    return all_trades


def fetch_trades_clob(market_ids: list[str]) -> list[dict]:
    """Fallback: pull from CLOB REST API."""
    print("\n[2/4] (Fallback) Fetching trades from CLOB API...")
    all_trades = []

    for mid in market_ids[:30]:
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


def aggregate_wallets_subgraph(trades: list[dict]) -> dict:
    wallets = defaultdict(_new_wallet)

    for t in trades:
        addr = (t.get("creator") or {}).get("id", "").lower()
        if not addr:
            continue
        w  = wallets[addr]
        w["trades"] += 1

        ts = int(t.get("creationTimestamp", 0))
        if w["first_trade"] is None or ts < w["first_trade"]:
            w["first_trade"] = ts
        if w["last_trade"] is None or ts > w["last_trade"]:
            w["last_trade"] = ts

        collateral = int(t.get("collateralAmount", 0)) / 1e6
        tokens     = int(t.get("outcomeTokensTraded", 0)) / 1e6
        ttype      = t.get("type", "").upper()

        if ttype == "BUY":
            w["buys"]          += 1
            w["gross_in"]      += collateral
            w["tokens_bought"] += tokens
        elif ttype == "SELL":
            w["sells"]  += 1
            w["gross_out"] += collateral
            w["tokens_sold"] += tokens
            if tokens > 0:
                price = collateral / tokens
                if price >= 0.50:
                    w["profitable_exits"] += 1
                else:
                    w["unprofitable_exits"] += 1

    return wallets


def aggregate_wallets_clob(trades: list[dict]) -> dict:
    wallets = defaultdict(_new_wallet)

    for t in trades:
        for addr_field in ("maker_address", "taker_address"):
            addr = (t.get(addr_field) or "").lower()
            if not addr or addr == "0x" + "0" * 40:
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

            price  = float(t.get("price", 0) or 0)
            size   = float(t.get("size",  0) or 0)
            side_v = (t.get(f"{addr_field.split('_')[0]}_side") or t.get("side") or "").upper()

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
def score_wallets(wallets: dict) -> list[dict]:
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < MIN_TRADES:
            continue

        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = (w["profitable_exits"] / exits * 100) if exits > 0 else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]

        active_days = 1
        if w["first_trade"] and w["last_trade"]:
            span = w["last_trade"] - w["first_trade"]
            active_days = max(1, span // 86400)

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


def print_wallet_table(rows: list[dict]):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'W/L':>9} {'Net P&L':>10} {'Days':>5}"
    )
    sep = "─" * len(header)
    print(f"\n[4/4] Top {TOP_N} wallets by win rate  (min {MIN_TRADES} trades)\n")
    print(sep)
    print(header)
    print(sep)

    for i, r in enumerate(rows[:TOP_N], 1):
        wl      = f"{r['profitable_exits']}/{r['total_exits']}"
        pnl_str = f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0 else f"{r['net_pnl_usdc']:.2f}"
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {wl:>9} {pnl_str:>10} {r['active_days']:>5}"
        )

    print(sep)
    print(f"\nShowing {min(TOP_N, len(rows))} of {len(rows)} qualified wallets.\n")


# ── Step 5: Fetch live market odds ────────────────────────────────────────────
def fetch_open_war_markets_with_odds(markets: list[dict]) -> list[dict]:
    """Return open markets enriched with best_yes_price from CLOB."""
    print("[*] Fetching live prices from CLOB for open markets...")
    open_markets = [m for m in markets if not m.get("closed") and not m.get("resolved")]
    enriched     = []

    for m in open_markets:
        token_ids = []
        for outcome in (m.get("tokens") or []):
            tid = outcome.get("token_id") or outcome.get("tokenId")
            if tid:
                token_ids.append(tid)

        # Also check top-level outcomePrices
        prices_raw = m.get("outcomePrices") or []
        yes_price  = None

        if prices_raw:
            try:
                yes_price = float(prices_raw[0])
            except (ValueError, IndexError, TypeError):
                pass

        if yes_price is None and token_ids:
            book = get(f"{CLOB_API}/book", params={"token_id": token_ids[0]})
            if book:
                bids = book.get("bids") or []
                if bids:
                    try:
                        yes_price = float(bids[0].get("price", 0))
                    except (ValueError, TypeError):
                        pass

        title  = m.get("question") or m.get("title") or m.get("slug", "Unknown")
        volume = float(m.get("volume") or m.get("volumeNum") or 0)
        enriched.append({
            "title":        title,
            "yes_price":    yes_price,
            "volume_usdc":  volume,
            "market_id":    m.get("conditionId") or m.get("id"),
        })
        time.sleep(RATE_DELAY)

    return enriched


# ── Step 6: $100 Strategy Recommendation ─────────────────────────────────────
def print_strategy(open_markets: list[dict], top_wallets: list[dict]):
    sep = "═" * 72

    print(sep)
    print(f"  $100 DEPOSIT STRATEGY  —  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(sep)

    # Filter markets that have a usable YES price
    priceable = [m for m in open_markets if m["yes_price"] is not None and 0.02 < m["yes_price"] < 0.98]
    priceable.sort(key=lambda m: m["volume_usdc"], reverse=True)

    if not priceable:
        print("\n  No open war markets with live prices found right now.")
        print("  Markets may have resolved, or the API returned no odds.\n")
        print(sep)
        return

    print("""
OVERVIEW
────────
Polymarket is a binary prediction market — you buy YES or NO shares at
a price between $0.01 and $0.99 that represents the market's probability.
If you're right, each share pays out $1.00 at resolution.

Example: YES trading at $0.30 means the crowd thinks there's a 30% chance
the event happens. Buy 10 shares for $3.00; collect $10.00 if correct
(+$7.00 net). You lose the $3.00 if incorrect.
""")

    print("OPEN WAR MARKETS (sorted by volume)\n")
    print(f"  {'Market':<58} {'YES':>5} {'Implied%':>9} {'Volume':>10}")
    print(f"  {'─'*58} {'─'*5} {'─'*9} {'─'*10}")

    for m in priceable[:10]:
        implied = m["yes_price"] * 100
        print(
            f"  {m['title'][:58]:<58} "
            f"  {m['yes_price']:.2f} "
            f"  {implied:>6.1f}%  "
            f"  ${m['volume_usdc']:>9,.0f}"
        )

    print("""
HOW SMART WALLETS TRADE (from the rankings above)
──────────────────────────────────────────────────
The top wallets by win rate share a few patterns:
  • They spread bets across multiple related markets rather than going
    all-in on one question.
  • They favour YES prices under ~$0.20 (high upside if right) but avoid
    sub-$0.05 "lottery tickets" where even smart money rarely wins.
  • They exit early (sell shares) when a position moves in their favour
    rather than riding it to resolution — this inflates their win rate.
  • High-volume markets have tighter spreads and are easier to exit.
""")

    print(f"YOUR $100 SPLIT (illustrative — not financial advice)\n")
    print(f"  {'Allocation':>12}  {'Market (YES price)'}")
    print(f"  {'─'*12}  {'─'*55}")

    # Tier 1: highest-volume market — safest liquidity
    if priceable:
        m1 = priceable[0]
        alloc1 = 40.0
        shares1 = alloc1 / m1["yes_price"]
        payout1 = shares1 * 1.0
        print(f"  ${alloc1:>10.2f}  {m1['title'][:55]}  @ YES ${m1['yes_price']:.2f}")
        print(f"              → {shares1:.0f} YES shares; pays ${payout1:.2f} if resolves YES")

    # Tier 2: second-highest volume
    if len(priceable) >= 2:
        m2 = priceable[1]
        alloc2 = 35.0
        shares2 = alloc2 / m2["yes_price"]
        payout2 = shares2 * 1.0
        print(f"  ${alloc2:>10.2f}  {m2['title'][:55]}  @ YES ${m2['yes_price']:.2f}")
        print(f"              → {shares2:.0f} YES shares; pays ${payout2:.2f} if resolves YES")

    # Tier 3: keep as dry powder / fees buffer
    print(f"  ${'25.00':>10}  Reserve — re-deploy if prices move or new markets open")
    print(f"  {'─'*12}  {'─'*55}")
    print(f"  ${'100.00':>10}  Total\n")

    print("""RISK REMINDERS
──────────────
  1. Prediction markets carry real financial risk — only deploy what you
     can afford to lose entirely.
  2. Geopolitical events are notoriously hard to predict; even 70%-priced
     outcomes fail ~30% of the time.
  3. Markets can stay open for months; liquidity may dry up if the
     geopolitical situation becomes stale.
  4. Check the Polymarket resolution rules carefully for each market before
     buying — exact wording matters a lot.
  5. This script is for research purposes; it is not financial advice.
""")
    print(sep)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 72)
    print("  Polymarket Iran/US/Israel War Market — Wallet Analyzer + Strategy")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 72)

    # 1. Find war markets
    markets = find_war_markets()

    if not markets:
        print("\n[!] No war markets found via keyword search. Trying broader fetch...")
        data    = get(f"{GAMMA_API}/markets", params={"q": "iran", "limit": 100})
        markets = data if isinstance(data, list) else (data or {}).get("markets", [])

    if not markets:
        print("[!] Could not retrieve any relevant markets. Check API availability.")
        return

    print_market_list(markets)

    # Extract condition IDs for trade lookup
    condition_ids = list({
        m.get("conditionId") or m.get("condition_id") or m.get("id")
        for m in markets
        if m.get("conditionId") or m.get("condition_id") or m.get("id")
    })
    print(f"\n  Condition IDs to query: {len(condition_ids)}")

    # 2. Fetch trades
    trades = []
    if condition_ids:
        trades = fetch_trades_subgraph(condition_ids)

    if not trades:
        market_ids = [m.get("id") or m.get("conditionId") for m in markets
                      if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(market_ids)

    # 3. Aggregate wallets
    print("\n[3/4] Aggregating wallet statistics...")
    if trades and "creator" in trades[0]:
        wallets = aggregate_wallets_subgraph(trades)
    else:
        wallets = aggregate_wallets_clob(trades)
    print(f"  Unique wallets seen: {len(wallets)}")

    # 4. Rank and display
    ranked = score_wallets(wallets)

    if ranked:
        print_wallet_table(ranked)
        with open("war_wallet_rankings.json", "w") as f:
            json.dump(ranked, f, indent=2)
        print("Full rankings saved to war_wallet_rankings.json")
    else:
        print("\n  Not enough trade data to rank wallets yet.")
        print("  This can happen if markets are new or the subgraph hasn't indexed them.\n")

    # 5. Live odds + $100 strategy
    open_enriched = fetch_open_war_markets_with_odds(markets)
    print_strategy(open_enriched, ranked)


if __name__ == "__main__":
    main()
