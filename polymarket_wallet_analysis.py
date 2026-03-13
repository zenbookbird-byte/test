#!/usr/bin/env python3
"""
Polymarket War-Market Wallet Analyzer + Copy-Trade Engine
──────────────────────────────────────────────────────────
Pulls on-chain trade data from Polymarket for Iran / US / Israel
war-related prediction markets and produces:

  1. Win-rate leaderboard (existing)
  2. Top-50 most profitable ACTIVE wallets on those specific markets
  3. Copy-trade signals derived from their current open positions,
     sized with an assumed 85% success rate and a $100 budget
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

MIN_TRADES          = 5     # min trades to appear in win-rate rankings
TOP_WINRATE         = 20    # wallets shown in win-rate table
TOP_PROFITABLE      = 50    # wallets shown in profit table
ACTIVE_WINDOW_DAYS  = 60    # wallet must have traded within this many days
MIN_WALLETS_SIGNAL  = 2     # min top-50 wallets sharing a position → copy signal
COPY_SUCCESS_RATE   = 0.85  # assumed success rate when copy-trading top wallets
COPY_BUDGET         = 100.0 # USD to allocate across copy signals
RATE_DELAY          = 0.3   # seconds between API calls

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
    print("\n[1/5] Searching Gamma API for Iran/US/Israel war markets...")
    markets = []
    seen    = set()

    search_terms = ["iran israel", "iran war", "israel attack", "us iran", "middle east war"]

    for term in search_terms:
        for closed in ("false", "true"):
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
    print("\n[2/5] Fetching trades from The Graph subgraph...")
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
    print("\n[2/5] (Fallback) Fetching trades from CLOB API...")
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
        # market_id → {net_tokens, total_cost, avg_entry}
        "positions": {},
    }


def _update_position(wallet: dict, market_id: str, tokens: float, cost: float, is_buy: bool):
    """Track net open position per market for copy-trade signal detection."""
    if not market_id:
        return
    pos = wallet["positions"].setdefault(market_id, {"net_tokens": 0.0, "total_cost": 0.0})
    if is_buy:
        pos["net_tokens"]  += tokens
        pos["total_cost"]  += cost
    else:
        # Selling reduces the position; reduce cost proportionally
        if pos["net_tokens"] > 0:
            ratio = min(tokens / pos["net_tokens"], 1.0)
            pos["total_cost"]  -= pos["total_cost"] * ratio
        pos["net_tokens"] = max(0.0, pos["net_tokens"] - tokens)


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
        market_id  = (t.get("fpmm") or {}).get("id", "")

        if ttype == "BUY":
            w["buys"]          += 1
            w["gross_in"]      += collateral
            w["tokens_bought"] += tokens
            _update_position(w, market_id, tokens, collateral, is_buy=True)
        elif ttype == "SELL":
            w["sells"]         += 1
            w["gross_out"]     += collateral
            w["tokens_sold"]   += tokens
            _update_position(w, market_id, tokens, collateral, is_buy=False)
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

            price    = float(t.get("price", 0) or 0)
            size     = float(t.get("size",  0) or 0)
            side_key = addr_field.split("_")[0]          # "maker" or "taker"
            side_v   = (t.get(f"{side_key}_side") or t.get("side") or "").upper()
            market_id = t.get("_market", "")

            if side_v == "BUY":
                w["buys"]          += 1
                w["gross_in"]      += price * size
                w["tokens_bought"] += size
                _update_position(w, market_id, size, price * size, is_buy=True)
            elif side_v == "SELL":
                w["sells"]         += 1
                w["gross_out"]     += price * size
                w["tokens_sold"]   += size
                _update_position(w, market_id, size, price * size, is_buy=False)
                if price >= 0.50:
                    w["profitable_exits"] += 1
                else:
                    w["unprofitable_exits"] += 1

    return wallets


# ── Step 4a: Score & rank by WIN RATE ────────────────────────────────────────
def score_wallets_winrate(wallets: dict) -> list[dict]:
    rows = []
    now  = int(time.time())

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

        last_trade_days_ago = (now - (w["last_trade"] or 0)) // 86400 if w["last_trade"] else 9999
        is_active = last_trade_days_ago <= ACTIVE_WINDOW_DAYS

        rows.append({
            "address":            addr,
            "trades":             w["trades"],
            "buys":               w["buys"],
            "sells":              w["sells"],
            "win_rate":           round(win_rate, 1),
            "profitable_exits":   w["profitable_exits"],
            "total_exits":        exits,
            "net_pnl_usdc":       round(net_pnl, 2),
            "gross_in_usdc":      round(w["gross_in"], 2),
            "gross_out_usdc":     round(w["gross_out"], 2),
            "trades_per_day":     round(w["trades"] / active_days, 1),
            "active_days":        active_days,
            "last_trade_days_ago": last_trade_days_ago,
            "is_active":          is_active,
            "positions":          w["positions"],
        })

    rows.sort(key=lambda r: (r["win_rate"], r["net_pnl_usdc"], r["trades"]), reverse=True)
    return rows


# ── Step 4b: Top-50 most profitable ACTIVE wallets ───────────────────────────
def top_profitable_active(all_rows: list[dict]) -> list[dict]:
    """Filter to active wallets only, sort by net P&L descending."""
    active = [r for r in all_rows if r["is_active"] and r["net_pnl_usdc"] > 0]
    active.sort(key=lambda r: r["net_pnl_usdc"], reverse=True)
    return active[:TOP_PROFITABLE]


# ── Step 4c: Print tables ─────────────────────────────────────────────────────
def print_winrate_table(rows: list[dict]):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'W/L':>9} {'Net P&L':>10} {'Days':>5} {'Active':>7}"
    )
    sep = "─" * len(header)
    print(f"\n── Win-Rate Leaderboard (top {TOP_WINRATE}, min {MIN_TRADES} trades) ──\n")
    print(sep); print(header); print(sep)

    for i, r in enumerate(rows[:TOP_WINRATE], 1):
        wl      = f"{r['profitable_exits']}/{r['total_exits']}"
        pnl_str = f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0 else f"{r['net_pnl_usdc']:.2f}"
        active  = f"{r['last_trade_days_ago']}d ago" if r["is_active"] else "inactive"
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {wl:>9} {pnl_str:>10} {r['active_days']:>5} {active:>7}"
        )
    print(sep)
    print(f"Showing {min(TOP_WINRATE, len(rows))} of {len(rows)} qualified wallets.\n")


def print_profitable_table(top50: list[dict]):
    header = (
        f"{'#':<4} {'Address':<44} {'Net P&L':>10} {'Win%':>6} "
        f"{'Trades':>7} {'ROI%':>7} {'Last trade':>11}"
    )
    sep = "─" * len(header)
    print(f"\n── Top {TOP_PROFITABLE} Most Profitable ACTIVE Wallets "
          f"(last {ACTIVE_WINDOW_DAYS} days, war markets only) ──\n")
    print(sep); print(header); print(sep)

    for i, r in enumerate(top50, 1):
        pnl_str = f"+{r['net_pnl_usdc']:.2f}"
        roi     = (r["net_pnl_usdc"] / r["gross_in_usdc"] * 100) if r["gross_in_usdc"] > 0 else 0
        roi_str = f"+{roi:.1f}%"
        last    = f"{r['last_trade_days_ago']}d ago"
        print(
            f"{i:<4} {r['address']:<44} {pnl_str:>10} "
            f"{r['win_rate']:>5.1f}% {r['trades']:>7} {roi_str:>7} {last:>11}"
        )

    print(sep)
    if not top50:
        print("  No active profitable wallets found — markets may be newly launched.\n")
    else:
        total_pnl = sum(r["net_pnl_usdc"] for r in top50)
        avg_pnl   = total_pnl / len(top50)
        print(f"  Combined P&L of top {len(top50)}: +${total_pnl:,.2f}  |  avg: +${avg_pnl:,.2f}\n")


# ── Step 5: Fetch live market odds ────────────────────────────────────────────
def fetch_open_war_markets_with_odds(markets: list[dict]) -> list[dict]:
    print("[*] Fetching live prices from CLOB for open markets...")
    open_markets = [m for m in markets if not m.get("closed") and not m.get("resolved")]
    enriched     = []

    for m in open_markets:
        token_ids  = []
        for outcome in (m.get("tokens") or []):
            tid = outcome.get("token_id") or outcome.get("tokenId")
            if tid:
                token_ids.append(tid)

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

        title     = m.get("question") or m.get("title") or m.get("slug", "Unknown")
        volume    = float(m.get("volume") or m.get("volumeNum") or 0)
        market_id = m.get("conditionId") or m.get("id") or ""
        enriched.append({
            "title":       title,
            "yes_price":   yes_price,
            "volume_usdc": volume,
            "market_id":   market_id,
        })
        time.sleep(RATE_DELAY)

    return enriched


# ── Step 6: Copy-trade signal engine ─────────────────────────────────────────
def build_copy_signals(
    top50: list[dict],
    open_enriched: list[dict],
) -> list[dict]:
    """
    For each open market, count how many of the top-50 profitable wallets
    currently hold an open long position (net_tokens > 0).

    Signal fields:
      market_title      — question text
      yes_price         — current live YES price
      volume_usdc       — total volume traded
      wallet_count      — # of top-50 wallets long this market
      avg_entry_price   — their volume-weighted average entry
      ev_85             — EV assuming COPY_SUCCESS_RATE win rate
      wallets           — list of {address, net_tokens, avg_entry}
    """
    open_ids = {m["market_id"]: m for m in open_enriched if m["market_id"]}
    signals  = []

    for mkt in open_enriched:
        mid = mkt["market_id"]
        if not mid or mkt["yes_price"] is None:
            continue

        holders = []
        for w in top50:
            pos = w["positions"].get(mid)
            if pos and pos["net_tokens"] > 0.5:          # dust filter
                avg_entry = (
                    pos["total_cost"] / pos["net_tokens"]
                    if pos["net_tokens"] > 0 else mkt["yes_price"]
                )
                holders.append({
                    "address":    w["address"],
                    "net_tokens": round(pos["net_tokens"], 2),
                    "avg_entry":  round(avg_entry, 4),
                    "net_pnl":    w["net_pnl_usdc"],
                    "win_rate":   w["win_rate"],
                })

        if len(holders) < MIN_WALLETS_SIGNAL:
            continue

        total_tokens = sum(h["net_tokens"] for h in holders)
        total_cost   = sum(h["avg_entry"] * h["net_tokens"] for h in holders)
        avg_entry    = total_cost / total_tokens if total_tokens > 0 else mkt["yes_price"]

        # EV = P(win)*profit_per_share - P(lose)*cost_per_share
        # Using current yes_price as entry for new copier
        p = mkt["yes_price"]
        ev = COPY_SUCCESS_RATE * (1.0 - p) - (1.0 - COPY_SUCCESS_RATE) * p

        signals.append({
            "market_title":    mkt["title"],
            "yes_price":       p,
            "volume_usdc":     mkt["volume_usdc"],
            "wallet_count":    len(holders),
            "avg_entry_price": round(avg_entry, 4),
            "ev_85":           round(ev, 4),
            "wallets":         sorted(holders, key=lambda h: h["net_pnl"], reverse=True),
        })

    # Rank: more wallets first, then higher EV
    signals.sort(key=lambda s: (s["wallet_count"], s["ev_85"]), reverse=True)
    return signals


def allocate_budget(signals: list[dict], budget: float) -> list[dict]:
    """
    Kelly-inspired proportional sizing: weight each signal by
    wallet_count × ev_85, then scale to budget.
    Only include signals with positive EV.
    """
    positive = [s for s in signals if s["ev_85"] > 0]
    if not positive:
        return []

    weights = [s["wallet_count"] * s["ev_85"] for s in positive]
    total_w = sum(weights)
    for s, w in zip(positive, weights):
        s["allocation"] = round(budget * (w / total_w), 2)
        s["shares"]     = round(s["allocation"] / s["yes_price"], 1) if s["yes_price"] > 0 else 0
        s["win_payout"] = round(s["shares"] * 1.0, 2)
        s["net_profit"] = round(s["win_payout"] - s["allocation"], 2)
    return positive


def print_copy_signals(signals: list[dict]):
    sep = "═" * 76

    print(f"\n{sep}")
    print(f"  COPY-TRADE SIGNALS  —  top-{TOP_PROFITABLE} profitable active wallets")
    print(f"  Assumed success rate: {COPY_SUCCESS_RATE*100:.0f}%   Budget: ${COPY_BUDGET:.2f}")
    print(sep)

    if not signals:
        print("""
  No copy signals generated. Reasons:
    • No open war markets with < 2 top-50 wallets holding positions
    • Wallets may have fully exited their positions before resolution
    • The subgraph / CLOB may not yet reflect the latest on-chain state

  Re-run when more markets are open or after a geopolitical event.
""")
        print(sep)
        return

    print(f"""
HOW THIS WORKS
──────────────
We identified which of the top-{TOP_PROFITABLE} most profitable wallets currently
hold open YES positions on active war markets. When {MIN_WALLETS_SIGNAL}+ of them agree,
that's a signal. We size each bet using:

  EV = {COPY_SUCCESS_RATE} × (1 − YES_price) − {1-COPY_SUCCESS_RATE:.2f} × YES_price

A signal is only included if EV > 0 (i.e., YES_price < {COPY_SUCCESS_RATE:.2f}).
Allocation is weighted by (wallet_count × EV) — more consensus + better
odds → bigger slice of the ${COPY_BUDGET:.0f}.
""")

    for i, s in enumerate(signals, 1):
        ev_pct = s["ev_85"] * 100
        print(f"  Signal #{i}  {'━'*55}")
        print(f"  Market   : {s['market_title'][:72]}")
        print(f"  YES price: ${s['yes_price']:.3f}  ({s['yes_price']*100:.1f}% implied prob)")
        print(f"  Volume   : ${s['volume_usdc']:,.0f}")
        print(f"  Consensus: {s['wallet_count']} of top-{TOP_PROFITABLE} wallets long")
        print(f"  Avg entry: ${s['avg_entry_price']:.3f} (their cost basis)")
        print(f"  EV @{COPY_SUCCESS_RATE*100:.0f}%  : {ev_pct:+.1f}¢ per $1 risked")

        if "allocation" in s:
            print(f"  ── Your position ─────────────────────────────────────")
            print(f"  Allocate : ${s['allocation']:.2f}")
            print(f"  Shares   : {s['shares']:.0f} YES shares @ ${s['yes_price']:.3f}")
            print(f"  Payout   : ${s['win_payout']:.2f} if YES resolves  "
                  f"(net +${s['net_profit']:.2f})")
            print(f"  Loss     : -${s['allocation']:.2f} if NO resolves")

        print(f"\n  Wallets in this signal:")
        print(f"    {'Address':<44} {'Tokens':>8} {'Avg entry':>10} {'P&L':>10} {'Win%':>6}")
        print(f"    {'─'*44} {'─'*8} {'─'*10} {'─'*10} {'─'*6}")
        for h in s["wallets"]:
            pnl_s = f"+${h['net_pnl']:.2f}" if h["net_pnl"] >= 0 else f"-${abs(h['net_pnl']):.2f}"
            print(
                f"    {h['address']:<44} {h['net_tokens']:>8.1f} "
                f"  ${h['avg_entry']:>8.4f} {pnl_s:>10} {h['win_rate']:>5.1f}%"
            )
        print()

    # Summary row
    if signals and "allocation" in signals[0]:
        total_alloc  = sum(s["allocation"] for s in signals)
        total_payout = sum(s["win_payout"] for s in signals)
        total_profit = sum(s["net_profit"] for s in signals)
        reserve      = COPY_BUDGET - total_alloc
        print(f"  {'─'*55}")
        print(f"  Total deployed : ${total_alloc:.2f}  |  Reserve: ${reserve:.2f}")
        print(f"  If ALL win     : +${total_profit:.2f} profit  (total ${total_payout:.2f} returned)")
        print(f"  If ALL lose    : -${total_alloc:.2f}")
        print()

    print("""IMPORTANT CAVEATS
─────────────────
  • 85% success rate is an ASSUMPTION based on these wallets' historical
    performance — it is not guaranteed and past results ≠ future results.
  • Copy-trading introduces lag: by the time you execute, the price may
    have moved against you versus their avg entry.
  • Geopolitical markets can gap suddenly on news; liquidity can vanish.
  • This is a research tool, not financial advice.
""")
    print(sep)


# ── Step 7: Classic $100 strategy (market-level, no copy) ────────────────────
def print_market_strategy(open_markets: list[dict]):
    sep = "═" * 72
    print(f"\n{sep}")
    print(f"  MARKET-LEVEL $100 STRATEGY  (for context — no copy signals needed)")
    print(sep)

    priceable = [m for m in open_markets if m["yes_price"] is not None and 0.02 < m["yes_price"] < 0.98]
    priceable.sort(key=lambda m: m["volume_usdc"], reverse=True)

    if not priceable:
        print("\n  No open war markets with live prices found right now.\n")
        print(sep)
        return

    print("\nOPEN WAR MARKETS (by volume)\n")
    print(f"  {'Market':<58} {'YES':>5} {'Prob%':>6} {'Volume':>10}")
    print(f"  {'─'*58} {'─'*5} {'─'*6} {'─'*10}")
    for m in priceable[:10]:
        print(
            f"  {m['title'][:58]:<58}"
            f"  {m['yes_price']:.2f}"
            f"  {m['yes_price']*100:>5.1f}%"
            f"  ${m['volume_usdc']:>9,.0f}"
        )

    print(f"\n$100 SPLIT (volume-weighted, no copy signals)\n")
    print(f"  {'Allocation':>12}  Details")
    print(f"  {'─'*12}  {'─'*58}")

    allocations = [(40.0, 0), (35.0, 1), (25.0, None)]
    for alloc, idx in allocations:
        if idx is None:
            print(f"  ${alloc:>10.2f}  Reserve / dry powder")
        elif idx < len(priceable):
            m = priceable[idx]
            shares = alloc / m["yes_price"]
            print(f"  ${alloc:>10.2f}  {m['title'][:50]}  @ ${m['yes_price']:.2f}")
            print(f"              → {shares:.0f} YES shares; pays ${shares:.2f} if YES")
    print(f"  {'─'*12}")
    print(f"  ${'100.00':>10}  Total\n")
    print(sep)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    banner = "═" * 72
    print(banner)
    print("  Polymarket Iran/US/Israel War Wallet Analyzer + Copy-Trade Engine")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(banner)

    # 1. Find markets
    markets = find_war_markets()
    if not markets:
        print("\n[!] Trying broader search for 'iran'...")
        data    = get(f"{GAMMA_API}/markets", params={"q": "iran", "limit": 100})
        markets = data if isinstance(data, list) else (data or {}).get("markets", [])

    if not markets:
        print("[!] Could not retrieve any relevant markets. Check API availability.")
        return

    print_market_list(markets)

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
    print("\n[3/5] Aggregating wallet statistics...")
    if trades and "creator" in trades[0]:
        wallets = aggregate_wallets_subgraph(trades)
    else:
        wallets = aggregate_wallets_clob(trades)
    print(f"  Unique wallets seen: {len(wallets)}")

    # 4. Score and display
    print("\n[4/5] Ranking wallets...")
    all_rows = score_wallets_winrate(wallets)
    top50    = top_profitable_active(all_rows)

    print_winrate_table(all_rows)
    print_profitable_table(top50)

    # Save full data
    output = {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "winrate_ranking": [{k: v for k, v in r.items() if k != "positions"} for r in all_rows],
        "top50_profitable": [{k: v for k, v in r.items() if k != "positions"} for r in top50],
    }
    with open("war_wallet_rankings.json", "w") as f:
        json.dump(output, f, indent=2)
    print("Rankings saved to war_wallet_rankings.json")

    # 5. Live odds
    print("\n[5/5] Fetching live market odds and building copy signals...")
    open_enriched = fetch_open_war_markets_with_odds(markets)

    # 6. Copy-trade signals
    signals  = build_copy_signals(top50, open_enriched)
    signals  = allocate_budget(signals, COPY_BUDGET)
    print_copy_signals(signals)

    # Save signals
    with open("copy_signals.json", "w") as f:
        safe_signals = [{k: v for k, v in s.items()} for s in signals]
        json.dump(safe_signals, f, indent=2)
    if signals:
        print(f"Copy signals saved to copy_signals.json ({len(signals)} signal(s))\n")

    # 7. Fallback market-level strategy
    print_market_strategy(open_enriched)


if __name__ == "__main__":
    main()
