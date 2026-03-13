#!/usr/bin/env python3
"""
Polymarket War-Market Wallet Analyzer + Multi-Period Copy-Trade Engine
───────────────────────────────────────────────────────────────────────
Pulls on-chain trade data from Polymarket for Iran / US / Israel
war-related prediction markets and produces:

  1. Win-rate leaderboard (all-time)
  2. Multi-period consistency table — wallets profitable in BOTH
     February 2026 AND March 2026 (required), plus June 2025 (bonus)
  3. Top-50 most profitable active wallets
  4. Copy-trade signals from multi-period wallets (primary) or
     top-50 wallets (fallback), sized with 85% assumed success rate
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

MIN_TRADES         = 5      # min trades to appear in win-rate rankings
TOP_WINRATE        = 20     # wallets shown in win-rate table
TOP_PROFITABLE     = 50     # wallets shown in profit table
ACTIVE_WINDOW_DAYS = 60     # wallet must have traded within this many days
MIN_WALLETS_SIGNAL = 2      # min wallets sharing a position → copy signal
COPY_SUCCESS_RATE  = 0.85   # assumed success rate when copy-trading
COPY_BUDGET        = 100.0  # USD to allocate across copy signals
RATE_DELAY         = 0.3    # seconds between API calls

WAR_KEYWORDS = [
    "iran", "israel", "hamas", "hezbollah", "war", "strike",
    "attack", "nuclear", "missile", "idf", "irgc", "us-iran",
    "us iran", "israel iran", "middle east", "gaza", "lebanon",
    "tehran", "netanyahu", "khamenei",
]

# ── Period windows (Unix timestamps, UTC) ─────────────────────────────────────
# June 2025 — bonus period (long-term consistency check)
_JUN25_S = int(datetime(2025, 6,  1,  0,  0,  0, tzinfo=timezone.utc).timestamp())
_JUN25_E = int(datetime(2025, 6, 30, 23, 59, 59, tzinfo=timezone.utc).timestamp())
# February 2026 — required
_FEB26_S = int(datetime(2026, 2,  1,  0,  0,  0, tzinfo=timezone.utc).timestamp())
_FEB26_E = int(datetime(2026, 2, 28, 23, 59, 59, tzinfo=timezone.utc).timestamp())
# March 2026 — required (current bets)
_MAR26_S = int(datetime(2026, 3,  1,  0,  0,  0, tzinfo=timezone.utc).timestamp())
_MAR26_E = int(datetime(2026, 3, 31, 23, 59, 59, tzinfo=timezone.utc).timestamp())

PERIODS: dict[str, tuple[int, int]] = {
    "jun_2025": (_JUN25_S, _JUN25_E),
    "feb_2026": (_FEB26_S, _FEB26_E),
    "mar_2026": (_MAR26_S, _MAR26_E),
}
PERIOD_LABEL = {
    "jun_2025": "Jun'25",
    "feb_2026": "Feb'26",
    "mar_2026": "Mar'26",
}
# Must appear in both of these to qualify for multi-period list
REQUIRED_PERIODS = {"feb_2026", "mar_2026"}


def ts_to_period(ts: int) -> str | None:
    """Return the period name a timestamp belongs to, or None."""
    for name, (start, end) in PERIODS.items():
        if start <= ts <= end:
            return name
    return None


def period_badge(flags: set) -> str:
    """Short badge string, e.g. '[Mar'26][Feb'26][Jun'25]'."""
    parts = [f"[{PERIOD_LABEL[p]}]" for p in ("mar_2026", "feb_2026", "jun_2025") if p in flags]
    return " ".join(parts) if parts else "[—]"


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
    print("\n[1/6] Searching Gamma API for Iran/US/Israel war markets...")
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
        status = "✓" if m.get("closed") or m.get("resolved") else "○"
        print(f"    [{status}] {title[:80]}  (vol: ${float(volume or 0):,.0f})")
    if len(markets) > 15:
        print(f"    … and {len(markets) - 15} more")


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


def fetch_trades_subgraph(condition_ids: list[str]) -> list[dict]:
    print("\n[2/6] Fetching trades from The Graph subgraph...")
    all_trades, skip = [], 0
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
    print("\n[2/6] (Fallback) Fetching trades from CLOB API...")
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
        "period_flags": set(),        # which time windows this wallet traded in
        "period_pnl":  {},            # period → (gross_in, gross_out) for per-period P&L
        "positions":   {},            # market_id → {net_tokens, total_cost}
    }


def _tag_period(wallet: dict, ts: int, collateral: float, is_buy: bool):
    """Record which period this trade belongs to and its contribution to P&L."""
    p = ts_to_period(ts)
    if p:
        wallet["period_flags"].add(p)
        pp = wallet["period_pnl"].setdefault(p, {"gross_in": 0.0, "gross_out": 0.0})
        if is_buy:
            pp["gross_in"]  += collateral
        else:
            pp["gross_out"] += collateral


def _update_position(wallet: dict, market_id: str, tokens: float, cost: float, is_buy: bool):
    if not market_id:
        return
    pos = wallet["positions"].setdefault(market_id, {"net_tokens": 0.0, "total_cost": 0.0})
    if is_buy:
        pos["net_tokens"] += tokens
        pos["total_cost"] += cost
    else:
        if pos["net_tokens"] > 0:
            ratio = min(tokens / pos["net_tokens"], 1.0)
            pos["total_cost"] -= pos["total_cost"] * ratio
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
            _tag_period(w, ts, collateral, is_buy=True)
            _update_position(w, market_id, tokens, collateral, is_buy=True)
        elif ttype == "SELL":
            w["sells"]         += 1
            w["gross_out"]     += collateral
            w["tokens_sold"]   += tokens
            _tag_period(w, ts, collateral, is_buy=False)
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

            price     = float(t.get("price", 0) or 0)
            size      = float(t.get("size",  0) or 0)
            side_key  = addr_field.split("_")[0]
            side_v    = (t.get(f"{side_key}_side") or t.get("side") or "").upper()
            market_id = t.get("_market", "")
            collateral = price * size

            if side_v == "BUY":
                w["buys"]          += 1
                w["gross_in"]      += collateral
                w["tokens_bought"] += size
                _tag_period(w, ts, collateral, is_buy=True)
                _update_position(w, market_id, size, collateral, is_buy=True)
            elif side_v == "SELL":
                w["sells"]         += 1
                w["gross_out"]     += collateral
                w["tokens_sold"]   += size
                _tag_period(w, ts, collateral, is_buy=False)
                _update_position(w, market_id, size, collateral, is_buy=False)
                if price >= 0.50:
                    w["profitable_exits"] += 1
                else:
                    w["unprofitable_exits"] += 1
    return wallets


# ── Step 4: Score & build rows ────────────────────────────────────────────────
def score_wallets(wallets: dict) -> list[dict]:
    now  = int(time.time())
    rows = []

    for addr, w in wallets.items():
        if w["trades"] < MIN_TRADES:
            continue

        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = (w["profitable_exits"] / exits * 100) if exits > 0 else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]

        span        = (w["last_trade"] - w["first_trade"]) if w["first_trade"] and w["last_trade"] else 0
        active_days = max(1, span // 86400)
        last_ago    = (now - (w["last_trade"] or 0)) // 86400 if w["last_trade"] else 9999
        is_active   = last_ago <= ACTIVE_WINDOW_DAYS

        flags        = w["period_flags"]
        period_score = len(flags)  # 0–3

        # Per-period P&L summary (for display)
        period_pnl_summary = {}
        for p, pp in w["period_pnl"].items():
            period_pnl_summary[p] = round(pp["gross_out"] - pp["gross_in"], 2)

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
            "last_trade_days_ago": last_ago,
            "is_active":          is_active,
            "period_flags":       flags,          # set — removed before JSON
            "period_score":       period_score,
            "period_pnl":         period_pnl_summary,
            "positions":          w["positions"], # dict — removed before JSON
        })

    rows.sort(key=lambda r: (r["win_rate"], r["net_pnl_usdc"], r["trades"]), reverse=True)
    return rows


# ── Step 5a: Multi-period consistency list ────────────────────────────────────
def multi_period_wallets(all_rows: list[dict]) -> list[dict]:
    """
    Wallets that:
      - traded profitably in BOTH Feb 2026 AND Mar 2026 (required)
      - traded in Jun 2025 (bonus — period_score == 3)
      - have positive net P&L overall
    Sorted by period_score desc, then net_pnl desc.
    """
    qualified = []
    for r in all_rows:
        flags = r["period_flags"]
        if not REQUIRED_PERIODS.issubset(flags):
            continue
        if r["net_pnl_usdc"] <= 0:
            continue
        qualified.append(r)
    qualified.sort(key=lambda r: (r["period_score"], r["net_pnl_usdc"]), reverse=True)
    return qualified


# ── Step 5b: Top-50 by P&L (active within window) ────────────────────────────
def top_profitable_active(all_rows: list[dict]) -> list[dict]:
    active = [r for r in all_rows if r["is_active"] and r["net_pnl_usdc"] > 0]
    active.sort(key=lambda r: r["net_pnl_usdc"], reverse=True)
    return active[:TOP_PROFITABLE]


# ── Step 6: Print tables ──────────────────────────────────────────────────────
def print_winrate_table(rows: list[dict]):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'W/L':>9} {'Net P&L':>10} {'Days':>5} {'Last':>8}"
    )
    sep = "─" * len(header)
    print(f"\n── Win-Rate Leaderboard (top {TOP_WINRATE}, min {MIN_TRADES} trades) ──\n")
    print(sep); print(header); print(sep)
    for i, r in enumerate(rows[:TOP_WINRATE], 1):
        wl      = f"{r['profitable_exits']}/{r['total_exits']}"
        pnl_str = f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0 else f"{r['net_pnl_usdc']:.2f}"
        last    = f"{r['last_trade_days_ago']}d ago"
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {wl:>9} {pnl_str:>10} {r['active_days']:>5} {last:>8}"
        )
    print(sep)
    print(f"Showing {min(TOP_WINRATE, len(rows))} of {len(rows)} qualified wallets.\n")


def print_multi_period_table(rows: list[dict]):
    """Show wallets active across multiple specific time windows."""
    header = (
        f"{'#':<4} {'Address':<44} {'Periods':<24} {'Net P&L':>10} "
        f"{'Win%':>6} {'Trades':>7} {'ROI%':>7}"
    )
    sep = "─" * len(header)
    title = (
        f"── Multi-Period Consistent Wallets  "
        f"(Mar'26 + Feb'26 required  |  Jun'25 = bonus) ──"
    )
    print(f"\n{title}\n")
    print(sep); print(header); print(sep)

    if not rows:
        print("  No wallets qualify yet — either:")
        print("  • Markets are too new (no Jun'25 / Feb'26 history)")
        print("  • Trade data not yet indexed by the subgraph\n")
        print(sep)
        return

    for i, r in enumerate(rows, 1):
        badge   = period_badge(r["period_flags"])
        pnl_str = f"+${r['net_pnl_usdc']:.2f}"
        roi     = (r["net_pnl_usdc"] / r["gross_in_usdc"] * 100) if r["gross_in_usdc"] > 0 else 0
        roi_str = f"+{roi:.1f}%"
        star    = "★" if r["period_score"] == 3 else " "
        print(
            f"{star}{i:<3} {r['address']:<44} {badge:<24} {pnl_str:>10} "
            f"{r['win_rate']:>5.1f}% {r['trades']:>7} {roi_str:>7}"
        )
        # Show per-period P&L inline
        pp = r["period_pnl"]
        detail_parts = []
        for p in ("mar_2026", "feb_2026", "jun_2025"):
            if p in pp:
                v = pp[p]
                sign = "+" if v >= 0 else ""
                detail_parts.append(f"{PERIOD_LABEL[p]}: {sign}${v:.2f}")
        if detail_parts:
            print(f"     {'   '.join(detail_parts)}")

    print(sep)
    stars  = sum(1 for r in rows if r["period_score"] == 3)
    total  = sum(r["net_pnl_usdc"] for r in rows)
    print(f"  {len(rows)} wallets qualified  |  ★ {stars} active all 3 periods  "
          f"|  combined P&L: +${total:,.2f}\n")


def print_profitable_table(top50: list[dict]):
    header = (
        f"{'#':<4} {'Address':<44} {'Net P&L':>10} {'Win%':>6} "
        f"{'Trades':>7} {'ROI%':>7} {'Periods':<22} {'Last':>8}"
    )
    sep = "─" * len(header)
    print(f"\n── Top {TOP_PROFITABLE} Most Profitable Active Wallets "
          f"(last {ACTIVE_WINDOW_DAYS} days) ──\n")
    print(sep); print(header); print(sep)

    for i, r in enumerate(top50, 1):
        pnl_str = f"+${r['net_pnl_usdc']:.2f}"
        roi     = (r["net_pnl_usdc"] / r["gross_in_usdc"] * 100) if r["gross_in_usdc"] > 0 else 0
        roi_str = f"+{roi:.1f}%"
        last    = f"{r['last_trade_days_ago']}d ago"
        badge   = period_badge(r["period_flags"])
        print(
            f"{i:<4} {r['address']:<44} {pnl_str:>10} "
            f"{r['win_rate']:>5.1f}% {r['trades']:>7} {roi_str:>7} {badge:<22} {last:>8}"
        )

    print(sep)
    if not top50:
        print("  No active profitable wallets found.\n")
    else:
        total = sum(r["net_pnl_usdc"] for r in top50)
        avg   = total / len(top50)
        print(f"  {len(top50)} wallets  |  combined P&L: +${total:,.2f}  |  avg: +${avg:,.2f}\n")


# ── Step 7: Fetch live odds ───────────────────────────────────────────────────
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


# ── Step 8: Copy-trade signal engine ─────────────────────────────────────────
def build_copy_signals(
    source_wallets: list[dict],
    open_enriched:  list[dict],
    label:          str = "source",
) -> list[dict]:
    """
    For each open market find source_wallets with open YES positions.
    Returns signals sorted by (wallet_count, ev_85) descending.
    """
    signals = []

    for mkt in open_enriched:
        mid = mkt["market_id"]
        if not mid or mkt["yes_price"] is None:
            continue

        holders = []
        for w in source_wallets:
            pos = w["positions"].get(mid)
            if pos and pos["net_tokens"] > 0.5:
                avg_entry = (
                    pos["total_cost"] / pos["net_tokens"]
                    if pos["net_tokens"] > 0 else mkt["yes_price"]
                )
                holders.append({
                    "address":      w["address"],
                    "net_tokens":   round(pos["net_tokens"], 2),
                    "avg_entry":    round(avg_entry, 4),
                    "net_pnl":      w["net_pnl_usdc"],
                    "win_rate":     w["win_rate"],
                    "period_score": w["period_score"],
                    "periods":      period_badge(w["period_flags"]),
                })

        if len(holders) < MIN_WALLETS_SIGNAL:
            continue

        total_tokens = sum(h["net_tokens"] for h in holders)
        total_cost   = sum(h["avg_entry"] * h["net_tokens"] for h in holders)
        avg_entry    = total_cost / total_tokens if total_tokens > 0 else mkt["yes_price"]
        avg_pscore   = sum(h["period_score"] for h in holders) / len(holders)

        p  = mkt["yes_price"]
        ev = COPY_SUCCESS_RATE * (1.0 - p) - (1.0 - COPY_SUCCESS_RATE) * p

        signals.append({
            "source":          label,
            "market_title":    mkt["title"],
            "yes_price":       p,
            "volume_usdc":     mkt["volume_usdc"],
            "wallet_count":    len(holders),
            "avg_entry_price": round(avg_entry, 4),
            "avg_period_score": round(avg_pscore, 1),
            "ev_85":           round(ev, 4),
            "wallets":         sorted(holders, key=lambda h: h["net_pnl"], reverse=True),
        })

    signals.sort(key=lambda s: (s["avg_period_score"], s["wallet_count"], s["ev_85"]), reverse=True)
    return signals


def allocate_budget(signals: list[dict], budget: float) -> list[dict]:
    positive = [s for s in signals if s["ev_85"] > 0]
    if not positive:
        return []

    # Weight: period_score bonus × wallet_count × ev
    weights = [
        (1 + s["avg_period_score"] * 0.5) * s["wallet_count"] * s["ev_85"]
        for s in positive
    ]
    total_w = sum(weights)
    for s, w in zip(positive, weights):
        s["allocation"] = round(budget * (w / total_w), 2)
        s["shares"]     = round(s["allocation"] / s["yes_price"], 1) if s["yes_price"] > 0 else 0
        s["win_payout"] = round(s["shares"] * 1.0, 2)
        s["net_profit"] = round(s["win_payout"] - s["allocation"], 2)
    return positive


def print_copy_signals(signals: list[dict], source_label: str):
    sep = "═" * 78

    print(f"\n{sep}")
    print(f"  COPY-TRADE SIGNALS  [{source_label}]")
    print(f"  Success rate assumed: {COPY_SUCCESS_RATE*100:.0f}%   Budget: ${COPY_BUDGET:.2f}")
    print(sep)

    if not signals:
        print(f"""
  No copy signals from {source_label}.
  Possible reasons:
    • These wallets have no open positions on currently active war markets
    • Subgraph / CLOB data may lag on-chain state by a few minutes
    • Markets may have just resolved — re-run after the next event
""")
        print(sep)
        return

    print(f"""
METHODOLOGY
───────────
Source : {source_label}
Signal : {MIN_WALLETS_SIGNAL}+ wallets from this group hold an open YES position
EV     : {COPY_SUCCESS_RATE} × (1 − YES_price) − {1-COPY_SUCCESS_RATE:.2f} × YES_price
Filter : only signals where EV > 0  (YES_price < ${COPY_SUCCESS_RATE:.2f})
Sizing : weighted by (1 + avg_period_score×0.5) × wallet_count × EV
         → more consistent, more agreed-upon, better-odds bets get larger slices
""")

    for i, s in enumerate(signals, 1):
        ev_pct = s["ev_85"] * 100
        src_tag = "★ MULTI-PERIOD" if s["source"] == "multi_period" else "top-50"
        print(f"  {'━'*74}")
        print(f"  Signal #{i}  [{src_tag}]  avg period score: {s['avg_period_score']:.1f}/3")
        print(f"  Market : {s['market_title'][:72]}")
        print(f"  Price  : ${s['yes_price']:.3f}  ({s['yes_price']*100:.1f}% implied prob)")
        print(f"  Volume : ${s['volume_usdc']:,.0f}  |  Consensus: {s['wallet_count']} wallets long")
        print(f"  Avg entry (their cost): ${s['avg_entry_price']:.3f}  "
              f"|  EV @{COPY_SUCCESS_RATE*100:.0f}%: {ev_pct:+.1f}¢ per $1")

        if "allocation" in s:
            print(f"  ── Your trade ────────────────────────────────────────────────────")
            print(f"  Allocate : ${s['allocation']:.2f}")
            print(f"  Buy      : {s['shares']:.0f} YES shares @ ${s['yes_price']:.3f}")
            print(f"  Win      : +${s['net_profit']:.2f}  (collect ${s['win_payout']:.2f})")
            print(f"  Lose     : -${s['allocation']:.2f}")

        print(f"\n  Holders ({len(s['wallets'])} wallets):")
        print(f"    {'Address':<44} {'Tokens':>7} {'Entry':>8} {'P&L':>10} {'Win%':>6} {'Periods'}")
        print(f"    {'─'*44} {'─'*7} {'─'*8} {'─'*10} {'─'*6} {'─'*22}")
        for h in s["wallets"]:
            pnl_s = f"+${h['net_pnl']:.2f}" if h["net_pnl"] >= 0 else f"-${abs(h['net_pnl']):.2f}"
            print(
                f"    {h['address']:<44} {h['net_tokens']:>7.1f} "
                f"  ${h['avg_entry']:>6.4f} {pnl_s:>10} {h['win_rate']:>5.1f}%  {h['periods']}"
            )
        print()

    if "allocation" in signals[0]:
        total_alloc  = sum(s["allocation"] for s in signals)
        total_payout = sum(s["win_payout"] for s in signals)
        total_profit = sum(s["net_profit"] for s in signals)
        reserve      = COPY_BUDGET - total_alloc
        print(f"  {'─'*55}")
        print(f"  Deployed  : ${total_alloc:.2f}   Reserve: ${reserve:.2f}")
        print(f"  All win   : +${total_profit:.2f} net  (${total_payout:.2f} returned)")
        print(f"  All lose  : -${total_alloc:.2f}")
        print()

    print("""CAVEATS
───────
  • 85% win rate is assumed from historical performance — not guaranteed.
  • Copy-trade lag: by the time you buy, price may differ from their entry.
  • Geopolitical markets can gap on news; liquidity can evaporate fast.
  • Check Polymarket resolution criteria before placing any bet.
  • This is a research tool — not financial advice.
""")
    print(sep)


# ── Step 9: Market-level $100 strategy (context / fallback) ──────────────────
def print_market_strategy(open_markets: list[dict]):
    sep = "═" * 72
    print(f"\n{sep}")
    print(f"  MARKET-LEVEL $100 STRATEGY  (no copy signals — market overview)")
    print(sep)

    priceable = [m for m in open_markets if m["yes_price"] is not None and 0.02 < m["yes_price"] < 0.98]
    priceable.sort(key=lambda m: m["volume_usdc"], reverse=True)

    if not priceable:
        print("\n  No open war markets with live prices available.\n")
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

    print(f"\n$100 SPLIT (volume-weighted fallback)\n")
    print(f"  {'Allocation':>12}  Details")
    print(f"  {'─'*12}  {'─'*58}")
    for alloc, idx in [(40.0, 0), (35.0, 1), (25.0, None)]:
        if idx is None:
            print(f"  ${alloc:>10.2f}  Reserve / dry powder")
        elif idx < len(priceable):
            m      = priceable[idx]
            shares = alloc / m["yes_price"]
            print(f"  ${alloc:>10.2f}  {m['title'][:52]}  @ ${m['yes_price']:.2f}")
            print(f"              → {shares:.0f} YES shares; pays ${shares:.2f} if YES")
    print(f"  {'─'*12}")
    print(f"  ${'100.00':>10}  Total\n")
    print(sep)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    banner  = "═" * 72
    print(banner)
    print("  Polymarket War Wallet Analyzer + Multi-Period Copy-Trade Engine")
    print(f"  {now_str}")
    print(f"  Scanning: Mar 2026 (current) + Feb 2026 + Jun 2025 (bonus)")
    print(banner)

    # ── 1. Markets ────────────────────────────────────────────────────────────
    markets = find_war_markets()
    if not markets:
        print("\n[!] Broadening search to 'iran'...")
        data    = get(f"{GAMMA_API}/markets", params={"q": "iran", "limit": 100})
        markets = data if isinstance(data, list) else (data or {}).get("markets", [])
    if not markets:
        print("[!] No markets found. Check API availability.")
        return
    print_market_list(markets)

    condition_ids = list({
        m.get("conditionId") or m.get("condition_id") or m.get("id")
        for m in markets
        if m.get("conditionId") or m.get("condition_id") or m.get("id")
    })
    print(f"\n  Condition IDs to query: {len(condition_ids)}")

    # ── 2. Trades ─────────────────────────────────────────────────────────────
    trades = []
    if condition_ids:
        trades = fetch_trades_subgraph(condition_ids)
    if not trades:
        market_ids = [m.get("id") or m.get("conditionId") for m in markets
                      if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(market_ids)

    # ── 3. Aggregate ──────────────────────────────────────────────────────────
    print("\n[3/6] Aggregating wallet statistics (with period tagging)...")
    if trades and "creator" in trades[0]:
        wallets = aggregate_wallets_subgraph(trades)
    else:
        wallets = aggregate_wallets_clob(trades)
    print(f"  Unique wallets seen: {len(wallets)}")

    # ── 4. Score ──────────────────────────────────────────────────────────────
    print("\n[4/6] Scoring and ranking wallets...")
    all_rows    = score_wallets(wallets)
    mp_wallets  = multi_period_wallets(all_rows)
    top50       = top_profitable_active(all_rows)

    print_winrate_table(all_rows)
    print_multi_period_table(mp_wallets)
    print_profitable_table(top50)

    # Save rankings
    def strip(r: dict) -> dict:
        return {
            k: (list(v) if isinstance(v, set) else v)
            for k, v in r.items()
            if k not in ("positions",)
        }

    output = {
        "generated_at":         now_str,
        "scan_periods": {
            "mar_2026": "2026-03-01 → 2026-03-31  [required]",
            "feb_2026": "2026-02-01 → 2026-02-28  [required]",
            "jun_2025": "2025-06-01 → 2025-06-30  [bonus]",
        },
        "winrate_ranking":      [strip(r) for r in all_rows],
        "multi_period_wallets": [strip(r) for r in mp_wallets],
        "top50_profitable":     [strip(r) for r in top50],
    }
    with open("war_wallet_rankings.json", "w") as f:
        json.dump(output, f, indent=2)
    print("Rankings saved → war_wallet_rankings.json")

    # ── 5. Live odds ──────────────────────────────────────────────────────────
    print("\n[5/6] Fetching live market odds...")
    open_enriched = fetch_open_war_markets_with_odds(markets)

    # ── 6. Copy signals ───────────────────────────────────────────────────────
    print("\n[6/6] Building copy-trade signals...")

    # Primary: multi-period wallets (highest confidence)
    mp_signals = build_copy_signals(mp_wallets, open_enriched, label="multi_period")
    mp_signals = allocate_budget(mp_signals, COPY_BUDGET)

    # Fallback: top-50 profitable active wallets
    t50_signals = build_copy_signals(top50, open_enriched, label="top50_profitable")
    t50_signals = allocate_budget(t50_signals, COPY_BUDGET)

    if mp_signals:
        print_copy_signals(mp_signals, source_label="Multi-Period Consistent Wallets (★ primary)")
    else:
        print("\n  [!] No multi-period signals — falling back to top-50 wallets.")

    if t50_signals:
        print_copy_signals(t50_signals, source_label="Top-50 Profitable Active Wallets (fallback)")
    elif not mp_signals:
        print_market_strategy(open_enriched)

    # Save signals
    all_signals = mp_signals + [s for s in t50_signals if s not in mp_signals]
    with open("copy_signals.json", "w") as f:
        json.dump(all_signals, f, indent=2, default=str)
    print(f"\nSignals saved → copy_signals.json  "
          f"({len(mp_signals)} multi-period  |  {len(t50_signals)} top-50)\n")

    # Always show market overview at end
    print_market_strategy(open_enriched)


if __name__ == "__main__":
    main()
