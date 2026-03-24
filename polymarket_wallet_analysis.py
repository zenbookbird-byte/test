#!/usr/bin/env python3
"""
Polymarket War-Market Wallet Analyzer + Advanced Copy-Trade Engine
───────────────────────────────────────────────────────────────────────
Pulls on-chain trade data from Polymarket for Iran / US / Israel
war-related prediction markets and produces:

  1. Win-rate leaderboard (all-time)
  2. Multi-period consistency table — wallets profitable in BOTH
     February 2026 AND March 2026 (required), plus June 2025 (bonus)
  3. Top-50 most profitable active wallets
  4. Sybil / copycat wallet detection (suppress fake consensus)
  5. Smart money convergence alerts (3+ sharp wallets entering same market)
  6. Exit / de-risk signals (sharp wallets selling positions)
  7. Contrarian edge scoring (smart money vs. crowd divergence)
  8. Copy-trade signals with Kelly criterion sizing
  9. Telegram / Discord alerts via alerts.py
 10. Wallet watchlist tracking via watchlist.py

Run standalone:  python polymarket_wallet_analysis.py
Run on schedule: python scheduler.py --loop 60
Alert test:      python alerts.py test
Watchlist:       python watchlist.py add 0xABC... "My label"
"""

import csv
import json
import math
import os
import requests
import sqlite3
import statistics
import time
from collections import defaultdict, deque
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
CACHE_DIR          = ".cache"
CACHE_TTL          = 3600   # seconds before cached API data is stale

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


# ── Cache helpers ─────────────────────────────────────────────────────────────
def load_cache(filename: str, ttl: int = CACHE_TTL):
    path = os.path.join(CACHE_DIR, filename)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            cached = json.load(f)
        if time.time() - cached.get("_cached_at", 0) > ttl:
            return None
        return cached.get("data")
    except (json.JSONDecodeError, OSError):
        return None


def save_cache(data, filename: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, filename)
    with open(path, "w") as f:
        json.dump({"_cached_at": time.time(), "data": data}, f)


def deduplicate_trades(trades: list) -> list:
    """Remove trades with duplicate IDs."""
    seen, result = set(), []
    for t in trades:
        tid = t.get("id")
        if tid is None:
            result.append(t)
        elif tid not in seen:
            seen.add(tid)
            result.append(t)
    removed = len(trades) - len(result)
    if removed:
        print(f"  [dedup] Removed {removed} duplicate trade(s).")
    return result


def group_trades_by_wallet(trades: list) -> dict:
    """Return {addr: [trade, ...]} for position-level analytics."""
    groups = defaultdict(list)
    for t in trades:
        addr = (t.get("creator") or {}).get("id", "").lower()
        if addr:
            groups[addr].append(t)
        else:
            for field in ("maker_address", "taker_address"):
                a = (t.get(field) or "").lower()
                if a and a != "0x" + "0" * 40:
                    groups[a].append(t)
    return dict(groups)


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


# ── Analytics: position matching & edge metrics ───────────────────────────────
def match_positions(trades: list) -> list:
    """FIFO buy→sell matching per market. Returns list of completed round trips."""
    by_market = defaultdict(list)
    for t in sorted(trades, key=lambda x: int(x.get("creationTimestamp", 0))):
        mid = (t.get("fpmm") or {}).get("id", "") or t.get("_market", "unknown")
        by_market[mid].append(t)

    matched = []
    for market_id, mkt_trades in by_market.items():
        buy_queue = deque()
        for t in mkt_trades:
            ttype      = (t.get("type") or "").upper()
            collateral = int(t.get("collateralAmount", 0)) / 1e6
            tokens     = int(t.get("outcomeTokensTraded", 0)) / 1e6
            ts         = int(t.get("creationTimestamp", 0))
            if tokens == 0:
                continue
            price = collateral / tokens
            if ttype == "BUY":
                buy_queue.append({"price": price, "size": tokens, "ts": ts})
            elif ttype == "SELL" and buy_queue:
                buy  = buy_queue.popleft()
                size = min(buy["size"], tokens)
                matched.append({
                    "market":      market_id,
                    "buy_ts":      buy["ts"],
                    "sell_ts":     ts,
                    "entry_price": buy["price"],
                    "exit_price":  price,
                    "size":        size,
                    "pnl":         (price - buy["price"]) * size,
                    "hold_secs":   max(0, ts - buy["ts"]),
                    "won":         price > buy["price"],
                })
    return matched


def binomial_pvalue(wins: int, total: int) -> float:
    """One-sided p-value P(X >= wins | p=0.5) via normal approx. < 0.05 = significant."""
    if total == 0:
        return 1.0
    z = (wins - 0.5 - total * 0.5) / math.sqrt(total * 0.25)
    return max(0.0, min(1.0, math.erfc(z / math.sqrt(2)) / 2))


def ev_score(matched: list) -> float:
    """Expected value per unit of collateral risked. Positive = edge."""
    if not matched:
        return 0.0
    wins   = [m for m in matched if m["won"]]
    losses = [m for m in matched if not m["won"]]
    n      = len(matched)

    def _norm(m):
        denom = m["entry_price"] * m["size"]
        return m["pnl"] / denom if denom else 0.0

    avg_win  = sum(_norm(m) for m in wins)   / len(wins)   if wins   else 0.0
    avg_loss = sum(_norm(m) for m in losses) / len(losses) if losses else 0.0
    return round(len(wins) / n * avg_win + len(losses) / n * avg_loss, 4)


def alpha_decay(matched: list) -> float:
    """recent_win_rate / early_win_rate. < 1.0 = edge shrinking."""
    if len(matched) < 10:
        return 1.0
    sorted_m  = sorted(matched, key=lambda m: m["buy_ts"])
    mid       = len(sorted_m) // 2
    early_wr  = sum(1 for m in sorted_m[:mid] if m["won"]) / mid
    recent_wr = sum(1 for m in sorted_m[mid:] if m["won"]) / (len(sorted_m) - mid)
    return round(recent_wr / early_wr, 3) if early_wr else 1.0


def hold_time_stats(matched: list) -> dict:
    """Median and mean hold time in seconds across all round trips."""
    if not matched:
        return {"median_hold_secs": 0, "mean_hold_secs": 0}
    holds = [m["hold_secs"] for m in matched]
    return {
        "median_hold_secs": int(statistics.median(holds)),
        "mean_hold_secs":   int(statistics.mean(holds)),
    }


def detect_strategy(trades_per_day: float) -> str:
    if trades_per_day >= 100:
        return "bot"
    if trades_per_day >= 10:
        return "scalper"
    return "swing"


# ── Sybil / Copycat Detection ────────────────────────────────────────────
# Detects wallets that trade the same markets within a tight time window,
# indicating they may be the same entity or coordinated actors.
# Returns a dict of cluster_id → [addresses] and tags each address.

SYBIL_WINDOW_SECS = 120   # trades within 2 min = suspicious
SYBIL_MIN_OVERLAP = 3     # min co-timed trades to flag as sybil pair


def detect_sybils(trades_by_wallet: dict) -> dict:
    """
    Build a trade-timing fingerprint per wallet, then find pairs whose trades
    overlap within SYBIL_WINDOW_SECS on the same markets at least
    SYBIL_MIN_OVERLAP times. Returns {cluster_id: [addr, ...], ...}.
    """
    # Build fingerprint: {addr: [(market_id, timestamp), ...]}
    fingerprints = {}
    for addr, trades in trades_by_wallet.items():
        events = []
        for t in trades:
            mid = (t.get("fpmm") or {}).get("id", "") or t.get("_market", "")
            ts = int(t.get("creationTimestamp", 0) or t.get("timestamp", 0) or 0)
            if mid and ts:
                events.append((mid, ts))
        if len(events) >= SYBIL_MIN_OVERLAP:
            fingerprints[addr] = sorted(events, key=lambda x: x[1])

    addrs = list(fingerprints.keys())
    # Union-Find for clustering
    parent = {a: a for a in addrs}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Pairwise comparison (only for wallets with enough trades)
    for i in range(len(addrs)):
        fp_i = fingerprints[addrs[i]]
        for j in range(i + 1, len(addrs)):
            fp_j = fingerprints[addrs[j]]
            overlap = 0
            ji = 0
            for mid_i, ts_i in fp_i:
                while ji < len(fp_j) and fp_j[ji][1] < ts_i - SYBIL_WINDOW_SECS:
                    ji += 1
                k = ji
                while k < len(fp_j) and fp_j[k][1] <= ts_i + SYBIL_WINDOW_SECS:
                    if fp_j[k][0] == mid_i:
                        overlap += 1
                        break
                    k += 1
            if overlap >= SYBIL_MIN_OVERLAP:
                union(addrs[i], addrs[j])

    # Build clusters (only groups of 2+)
    from collections import Counter
    groups = defaultdict(list)
    for a in addrs:
        groups[find(a)].append(a)
    clusters = {}
    cid = 0
    for root, members in groups.items():
        if len(members) >= 2:
            clusters[f"sybil_{cid}"] = members
            cid += 1
    return clusters


def deduplicate_sybil_signals(wallets: list[dict], sybil_clusters: dict) -> list[dict]:
    """From each sybil cluster, keep only the wallet with highest EV score."""
    suppressed = set()
    for cluster_id, members in sybil_clusters.items():
        best = max(members, key=lambda a: next(
            (w.get("ev_score", 0) for w in wallets if w["address"] == a), 0
        ))
        for a in members:
            if a != best:
                suppressed.add(a)
    return [w for w in wallets if w["address"] not in suppressed]


def print_sybil_report(sybil_clusters: dict):
    if not sybil_clusters:
        print("\n── Sybil Detection ─────────────────────────────────────")
        print("  No sybil clusters detected. All wallets appear independent.")
        print("────────────────────────────────────────────────────────\n")
        return
    sep = "─" * 72
    print(f"\n── Sybil / Copycat Detection ({'⚠ ' + str(len(sybil_clusters)) + ' clusters found'}) ──")
    print(sep)
    for cid, members in sybil_clusters.items():
        print(f"  Cluster {cid} ({len(members)} wallets — likely same entity):")
        for a in members:
            print(f"    • {a}")
    print(sep)
    print(f"  → {sum(len(m) - 1 for m in sybil_clusters.values())} duplicate wallets will be"
          f" suppressed from consensus signals.\n")


# ── Smart Money Convergence Alerts ────────────────────────────────────────
# Detects when multiple INDEPENDENT sharp wallets enter the same market
# within a tight time window — the strongest possible buy signal.

CONVERGENCE_WINDOW_HOURS = 24   # look for clustering within this window
CONVERGENCE_MIN_WALLETS  = 3    # minimum independent wallets


def detect_convergence(
    sharp_wallets: list[dict],
    trades_by_wallet: dict,
    sybil_clusters: dict,
) -> list[dict]:
    """
    Find markets where 3+ independent sharp wallets opened BUY positions
    within CONVERGENCE_WINDOW_HOURS of each other.
    Returns list of convergence events sorted by strength.
    """
    # Build sybil lookup: addr → representative
    sybil_rep = {}
    for cid, members in sybil_clusters.items():
        rep = members[0]
        for m in members:
            sybil_rep[m] = rep

    sharp_addrs = {w["address"] for w in sharp_wallets}
    window = CONVERGENCE_WINDOW_HOURS * 3600

    # Collect BUY events per market from sharp wallets
    market_buys = defaultdict(list)  # market_id → [(ts, addr), ...]
    for addr in sharp_addrs:
        trades = trades_by_wallet.get(addr, [])
        for t in trades:
            ttype = (t.get("type") or "").upper()
            if ttype != "BUY":
                side = (t.get("maker_side") or t.get("side") or "").upper()
                if side != "BUY":
                    continue
            mid = (t.get("fpmm") or {}).get("id", "") or t.get("_market", "")
            ts = int(t.get("creationTimestamp", 0) or t.get("timestamp", 0) or 0)
            if mid and ts:
                market_buys[mid].append((ts, addr))

    events = []
    for mid, buys in market_buys.items():
        buys.sort()
        # Sliding window to find clusters
        for i in range(len(buys)):
            cluster_addrs = set()
            independent = set()
            for j in range(i, len(buys)):
                if buys[j][0] - buys[i][0] > window:
                    break
                addr = buys[j][1]
                rep = sybil_rep.get(addr, addr)  # collapse sybils
                independent.add(rep)
                cluster_addrs.add(addr)
            if len(independent) >= CONVERGENCE_MIN_WALLETS:
                events.append({
                    "market_id": mid,
                    "window_start": buys[i][0],
                    "window_end": min(buys[i][0] + window, buys[-1][0]),
                    "wallets": list(cluster_addrs),
                    "independent_count": len(independent),
                    "strength": len(independent),  # more independent = stronger
                })
                break  # one event per market

    events.sort(key=lambda e: e["strength"], reverse=True)
    return events


def print_convergence_alerts(events: list[dict], market_titles: dict):
    sep = "═" * 72
    print(f"\n{sep}")
    print(f"  SMART MONEY CONVERGENCE ALERTS")
    print(f"  {len(events)} markets with independent sharp-wallet clustering")
    print(sep)
    if not events:
        print("  No convergence events detected in the current window.\n")
        print(sep)
        return
    for i, e in enumerate(events, 1):
        title = market_titles.get(e["market_id"], e["market_id"][:16] + "…")
        t0 = datetime.fromtimestamp(e["window_start"], tz=timezone.utc).strftime("%b %d %H:%M")
        t1 = datetime.fromtimestamp(e["window_end"], tz=timezone.utc).strftime("%b %d %H:%M")
        strength_bar = "█" * e["independent_count"] + "░" * (10 - e["independent_count"])
        print(f"\n  #{i}  Strength: [{strength_bar}] {e['independent_count']} independent wallets")
        print(f"  Market : {title[:68]}")
        print(f"  Window : {t0} → {t1} UTC")
        print(f"  Wallets:")
        for a in e["wallets"][:8]:
            print(f"    • {a}")
        if len(e["wallets"]) > 8:
            print(f"    … +{len(e['wallets']) - 8} more")
    print(f"\n{sep}\n")


# ── Kelly Criterion Position Sizing ──────────────────────────────────────
# Replace flat 85% assumption with mathematically optimal sizing
# based on each wallet's actual win rate and average payoff ratio.

def kelly_fraction(win_rate: float, avg_win: float, avg_loss: float) -> float:
    """
    Kelly fraction: f* = (p * b - q) / b
    where p = win prob, q = 1-p, b = avg_win/avg_loss (odds ratio).
    Returns fraction of bankroll to risk (0.0–1.0, clamped).
    """
    if avg_loss == 0 or win_rate <= 0:
        return 0.0
    p = win_rate
    q = 1.0 - p
    b = abs(avg_win / avg_loss) if avg_loss != 0 else 0.0
    if b == 0:
        return 0.0
    f = (p * b - q) / b
    # Half-Kelly for safety (standard practice)
    return max(0.0, min(0.5, f * 0.5))


def compute_kelly_for_wallet(matched: list) -> dict:
    """Compute Kelly sizing parameters from a wallet's matched trades."""
    if not matched:
        return {"kelly_f": 0.0, "avg_win_pct": 0.0, "avg_loss_pct": 0.0, "payoff_ratio": 0.0}
    wins = [m for m in matched if m["won"]]
    losses = [m for m in matched if not m["won"]]

    def _pct(m):
        cost = m["entry_price"] * m["size"]
        return m["pnl"] / cost if cost > 0 else 0.0

    avg_win_pct = sum(_pct(m) for m in wins) / len(wins) if wins else 0.0
    avg_loss_pct = abs(sum(_pct(m) for m in losses) / len(losses)) if losses else 0.0
    wr = len(wins) / len(matched)
    kf = kelly_fraction(wr, avg_win_pct, avg_loss_pct)
    payoff = avg_win_pct / avg_loss_pct if avg_loss_pct > 0 else 0.0
    return {
        "kelly_f": round(kf, 4),
        "avg_win_pct": round(avg_win_pct, 4),
        "avg_loss_pct": round(avg_loss_pct, 4),
        "payoff_ratio": round(payoff, 2),
    }


def allocate_budget_kelly(signals: list[dict], budget: float) -> list[dict]:
    """
    Size copy-trade positions using per-signal Kelly fractions
    instead of flat assumptions.
    """
    for s in signals:
        # Aggregate Kelly from contributing wallets
        kelly_fracs = []
        for h in s.get("wallets", []):
            kf = h.get("kelly_f", 0.0)
            if kf > 0:
                kelly_fracs.append(kf)
        if not kelly_fracs:
            s["kelly_alloc"] = 0.0
            s["kelly_shares"] = 0.0
            continue
        avg_kelly = sum(kelly_fracs) / len(kelly_fracs)
        s["kelly_f"] = round(avg_kelly, 4)

    # Normalize allocations to fit within budget
    total_kelly = sum(s.get("kelly_f", 0) for s in signals)
    if total_kelly == 0:
        return signals
    for s in signals:
        frac = s.get("kelly_f", 0) / total_kelly
        alloc = round(budget * frac, 2)
        s["kelly_alloc"] = alloc
        s["kelly_shares"] = round(alloc / s["yes_price"], 1) if s.get("yes_price", 0) > 0 else 0
    return signals


# ── Exit / De-Risk Signal Detection ──────────────────────────────────────
# Detects when sharp wallets are SELLING positions — equally valuable as
# buy signals. Means the edge is gone or they're taking profit.

def detect_exit_signals(
    sharp_wallets: list[dict],
    trades_by_wallet: dict,
    lookback_hours: int = 48,
) -> list[dict]:
    """
    Find recent SELL events from sharp wallets.
    Groups by market and returns exit signals sorted by urgency.
    """
    cutoff = int(time.time()) - lookback_hours * 3600
    sharp_addrs = {w["address"] for w in sharp_wallets}

    market_exits = defaultdict(list)  # market_id → [(ts, addr, tokens_sold)]
    for addr in sharp_addrs:
        trades = trades_by_wallet.get(addr, [])
        for t in trades:
            ttype = (t.get("type") or "").upper()
            if ttype != "SELL":
                side = (t.get("maker_side") or t.get("side") or "").upper()
                if side != "SELL":
                    continue
            ts = int(t.get("creationTimestamp", 0) or t.get("timestamp", 0) or 0)
            if ts < cutoff:
                continue
            mid = (t.get("fpmm") or {}).get("id", "") or t.get("_market", "")
            tokens = int(t.get("outcomeTokensTraded", 0)) / 1e6
            if not tokens:
                tokens = float(t.get("size", 0) or 0)
            if mid:
                market_exits[mid].append({"ts": ts, "addr": addr, "tokens": tokens})

    signals = []
    for mid, exits in market_exits.items():
        exits.sort(key=lambda x: x["ts"], reverse=True)
        unique_wallets = list({e["addr"] for e in exits})
        total_tokens = sum(e["tokens"] for e in exits)
        latest_ts = exits[0]["ts"]
        hours_ago = round((time.time() - latest_ts) / 3600, 1)

        if len(unique_wallets) >= 2:  # at least 2 sharp wallets exiting
            signals.append({
                "market_id": mid,
                "exit_count": len(exits),
                "unique_wallets": len(unique_wallets),
                "wallets": unique_wallets,
                "total_tokens_sold": round(total_tokens, 2),
                "latest_exit_hours_ago": hours_ago,
                "urgency": len(unique_wallets) * (1.0 / max(hours_ago, 0.1)),
            })

    signals.sort(key=lambda s: s["urgency"], reverse=True)
    return signals


def print_exit_signals(signals: list[dict], market_titles: dict):
    sep = "═" * 72
    print(f"\n{sep}")
    print(f"  EXIT / DE-RISK SIGNALS  (sharp wallets selling)")
    print(sep)
    if not signals:
        print("  No exit signals detected in the last 48h.\n")
        print(sep)
        return
    for i, s in enumerate(signals, 1):
        title = market_titles.get(s["market_id"], s["market_id"][:16] + "…")
        urgency = "🔴 HIGH" if s["urgency"] > 5 else "🟡 MEDIUM" if s["urgency"] > 2 else "🟢 LOW"
        print(f"\n  #{i}  Urgency: {urgency}")
        print(f"  Market     : {title[:64]}")
        print(f"  Exits      : {s['exit_count']} sells from {s['unique_wallets']} sharp wallets")
        print(f"  Tokens sold: {s['total_tokens_sold']:.1f}")
        print(f"  Latest     : {s['latest_exit_hours_ago']:.1f}h ago")
        print(f"  Wallets exiting:")
        for a in s["wallets"][:5]:
            print(f"    • {a}")
    print(f"\n  ⚠ If you hold positions in these markets, consider reducing exposure.")
    print(f"\n{sep}\n")


# ── Contrarian Edge Score ────────────────────────────────────────────────
# Measures divergence between smart-money positioning and market price.
# High score = sharp wallets disagree with the crowd → potential alpha.

def contrarian_edge(
    sharp_wallets: list[dict],
    open_enriched: list[dict],
) -> list[dict]:
    """
    For each open market, compute the gap between:
      - Smart money implied probability (% of sharp wallets long YES)
      - Market price (crowd's implied probability)
    Positive edge = smart money thinks YES is more likely than the crowd.
    Negative edge = smart money thinks NO is more likely than the crowd.
    """
    signals = []
    for mkt in open_enriched:
        mid = mkt["market_id"]
        price = mkt.get("yes_price")
        if not mid or price is None or price < 0.02 or price > 0.98:
            continue

        # Count sharp wallets with open YES positions
        long_count = 0
        short_or_neutral = 0
        total_tokens_long = 0.0
        for w in sharp_wallets:
            pos = w.get("positions", {}).get(mid)
            if pos and pos["net_tokens"] > 0.5:
                long_count += 1
                total_tokens_long += pos["net_tokens"]
            else:
                short_or_neutral += 1

        total_checked = long_count + short_or_neutral
        if total_checked < 3:  # need enough wallets for meaningful signal
            continue

        smart_money_prob = long_count / total_checked
        edge = smart_money_prob - price  # positive = smart money more bullish
        abs_edge = abs(edge)

        if abs_edge < 0.05:  # less than 5pp divergence = not interesting
            continue

        signals.append({
            "market_id": mid,
            "market_title": mkt.get("title", mid[:20]),
            "market_price": price,
            "smart_money_prob": round(smart_money_prob, 3),
            "crowd_prob": round(price, 3),
            "contrarian_edge": round(edge, 3),
            "abs_edge": round(abs_edge, 3),
            "direction": "BULLISH" if edge > 0 else "BEARISH",
            "long_wallets": long_count,
            "total_wallets": total_checked,
            "tokens_long": round(total_tokens_long, 1),
        })

    signals.sort(key=lambda s: s["abs_edge"], reverse=True)
    return signals


def print_contrarian_signals(signals: list[dict]):
    sep = "═" * 72
    print(f"\n{sep}")
    print(f"  CONTRARIAN EDGE SIGNALS  (smart money vs. crowd)")
    print(sep)
    if not signals:
        print("  No significant divergence between smart money and market prices.\n")
        print(sep)
        return
    print(f"\n  {'Market':<42} {'Crowd':>6} {'Smart$':>7} {'Edge':>7} {'Dir':>8} {'Wallets':>8}")
    print(f"  {'─'*42} {'─'*6} {'─'*7} {'─'*7} {'─'*8} {'─'*8}")
    for s in signals:
        edge_pct = s["contrarian_edge"] * 100
        color_prefix = "+" if edge_pct > 0 else ""
        print(
            f"  {s['market_title'][:42]:<42}"
            f" {s['crowd_prob']*100:>5.1f}%"
            f" {s['smart_money_prob']*100:>6.1f}%"
            f" {color_prefix}{edge_pct:>5.1f}pp"
            f" {s['direction']:>8}"
            f" {s['long_wallets']}/{s['total_wallets']:>5}"
        )
    print(f"\n  Interpretation:")
    print(f"  • BULLISH + large edge → smart money sees YES as underpriced by the crowd")
    print(f"  • BEARISH + large edge → smart money avoiding a market the crowd is long on")
    print(f"  • Largest edges often precede major price moves\n")
    print(sep)


# ── Step 4: Score & build rows ────────────────────────────────────────────────
def score_wallets(wallets: dict, trades_by_wallet: dict = None) -> list[dict]:
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

        matched_trades = match_positions(trades_by_wallet[addr]) if trades_by_wallet and addr in trades_by_wallet else []

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
            # ── new analytics ──────────────────────────────────────────────
            "strategy":           detect_strategy(round(w["trades"] / active_days, 1)),
            "ev_score":           ev_score(matched_trades),
            "pvalue":             round(binomial_pvalue(w["profitable_exits"], exits), 4) if exits > 0 else 1.0,
            "alpha_decay":        alpha_decay(matched_trades),
            "median_hold_secs":   hold_time_stats(matched_trades)["median_hold_secs"],
            "mean_hold_secs":     hold_time_stats(matched_trades)["mean_hold_secs"],
            "cluster":            "",             # filled by cluster_wallets()
            "sybil_cluster":      "",             # filled by tag_sybils()
            # ── Kelly criterion sizing ──────────────────────────────────────
            **compute_kelly_for_wallet(matched_trades),
        })

    # Primary sort by EV score (true edge), then win rate, then P&L
    rows.sort(key=lambda r: (r["ev_score"], r["win_rate"], r["net_pnl_usdc"]), reverse=True)
    return rows


def tag_sybils(rows: list, sybil_clusters: dict) -> list:
    """Tag each row with its sybil cluster ID (if any)."""
    addr_to_cluster = {}
    for cid, members in sybil_clusters.items():
        for a in members:
            addr_to_cluster[a] = cid
    for r in rows:
        r["sybil_cluster"] = addr_to_cluster.get(r["address"], "")
    return rows


def cluster_wallets(rows: list) -> list:
    """Label each wallet with a behavioural cluster based on edge quality."""
    for r in rows:
        pv    = r.get("pvalue", 1.0)
        ev    = r.get("ev_score", 0.0)
        decay = r.get("alpha_decay", 1.0)
        tpd   = r["trades_per_day"]

        if tpd >= 100:
            label = "hft_bot"
        elif pv < 0.01 and ev > 0.05 and decay >= 0.9:
            label = "sharp"
        elif pv < 0.05 and ev > 0:
            label = "edge"
        elif decay < 0.7:
            label = "fading"
        elif ev <= 0:
            label = "noise"
        else:
            label = "developing"

        r["cluster"] = label
    return rows


def export_csv(rows: list, path: str = "war_wallet_rankings.csv"):
    if not rows:
        return
    # Exclude non-serialisable / internal fields
    skip = {"period_flags", "positions"}
    clean = [{k: (list(v) if isinstance(v, set) else v)
              for k, v in r.items() if k not in skip}
             for r in rows]
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=clean[0].keys())
        writer.writeheader()
        writer.writerows(clean)
    print(f"CSV exported → {path}")


def snapshot_rankings(rows: list, db_path: str = "war_rankings_history.db"):
    """Append current rankings snapshot to a SQLite database."""
    if not rows:
        return
    con = sqlite3.connect(db_path)
    con.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            snapshot_at    TEXT,
            rank           INTEGER,
            address        TEXT,
            trades         INTEGER,
            win_rate       REAL,
            ev_score       REAL,
            pvalue         REAL,
            alpha_decay    REAL,
            net_pnl_usdc   REAL,
            trades_per_day REAL,
            active_days    INTEGER,
            strategy       TEXT,
            cluster        TEXT,
            period_score   INTEGER
        )
    """)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    con.executemany(
        "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (ts, i, r["address"], r["trades"], r["win_rate"],
             r.get("ev_score", 0), r.get("pvalue", 1), r.get("alpha_decay", 1),
             r["net_pnl_usdc"], r["trades_per_day"], r["active_days"],
             r.get("strategy", ""), r.get("cluster", ""), r.get("period_score", 0))
            for i, r in enumerate(rows, 1)
        ],
    )
    con.commit()
    con.close()
    print(f"Snapshot → {db_path}  ({len(rows)} rows at {ts})")


def print_summary_stats(rows: list):
    if not rows:
        return
    win_rates = [r["win_rate"]      for r in rows]
    pnls      = [r["net_pnl_usdc"]  for r in rows]
    ev_scores = [r.get("ev_score", 0) for r in rows]
    sig_count = sum(1 for r in rows if r.get("pvalue", 1) < 0.05)
    clusters  = {}
    for r in rows:
        c = r.get("cluster", "?")
        clusters[c] = clusters.get(c, 0) + 1
    print("\n── Summary Statistics ──────────────────────────────────")
    print(f"  Qualifying wallets  : {len(rows)}")
    print(f"  Statistically sig.  : {sig_count} ({sig_count / len(rows) * 100:.0f}%)")
    print(f"  Median win rate     : {statistics.median(win_rates):.1f}%")
    print(f"  Median EV score     : {statistics.median(ev_scores):+.4f}")
    print(f"  Median net P&L      : ${statistics.median(pnls):+.2f}")
    print(f"  Cluster breakdown   : {clusters}")
    print("────────────────────────────────────────────────────────\n")


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
    print("  Polymarket War Wallet Analyzer + Advanced Copy-Trade Engine")
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
    trades = load_cache("war_trades.json") or []
    if not trades:
        if condition_ids:
            trades = fetch_trades_subgraph(condition_ids)
        if not trades:
            market_ids = [m.get("id") or m.get("conditionId") for m in markets
                          if m.get("id") or m.get("conditionId")]
            trades = fetch_trades_clob(market_ids)
        if trades:
            save_cache(trades, "war_trades.json")
    trades = deduplicate_trades(trades)

    # ── 3. Aggregate ──────────────────────────────────────────────────────────
    print("\n[3/6] Aggregating wallet statistics (with period tagging)...")
    trades_by_wallet = group_trades_by_wallet(trades)
    if trades and "creator" in trades[0]:
        wallets = aggregate_wallets_subgraph(trades)
    else:
        wallets = aggregate_wallets_clob(trades)
    print(f"  Unique wallets seen: {len(wallets)}")

    # ── 4. Score & cluster ────────────────────────────────────────────────────
    print("\n[4/9] Scoring and ranking wallets...")
    all_rows    = score_wallets(wallets, trades_by_wallet=trades_by_wallet)
    cluster_wallets(all_rows)

    # ── 5. Sybil detection ────────────────────────────────────────────────────
    print("\n[5/9] Running sybil / copycat detection...")
    sybil_clusters = detect_sybils(trades_by_wallet)
    tag_sybils(all_rows, sybil_clusters)
    print_sybil_report(sybil_clusters)

    mp_wallets  = multi_period_wallets(all_rows)
    top50       = top_profitable_active(all_rows)

    print_winrate_table(all_rows)
    print_multi_period_table(mp_wallets)
    print_profitable_table(top50)
    print_summary_stats(all_rows)

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
        "sybil_clusters":       sybil_clusters,
    }
    with open("war_wallet_rankings.json", "w") as f:
        json.dump(output, f, indent=2)
    print("Rankings saved → war_wallet_rankings.json")
    export_csv(all_rows)
    snapshot_rankings(all_rows)

    # ── 6. Live odds ──────────────────────────────────────────────────────────
    print("\n[6/9] Fetching live market odds...")
    open_enriched = fetch_open_war_markets_with_odds(markets)

    # Build market_id → title lookup for reports
    market_titles = {m["market_id"]: m["title"] for m in open_enriched if m.get("market_id")}

    # ── 7. Smart money convergence + contrarian + exit signals ────────────────
    print("\n[7/9] Analyzing smart money convergence...")
    sharp_rows = [r for r in all_rows if r.get("cluster") in ("sharp", "edge")]
    convergence_events = detect_convergence(sharp_rows, trades_by_wallet, sybil_clusters)
    print_convergence_alerts(convergence_events, market_titles)

    print("\n[8/9] Scanning for exit / de-risk signals & contrarian edges...")
    exit_signals = detect_exit_signals(sharp_rows, trades_by_wallet)
    print_exit_signals(exit_signals, market_titles)

    contrarian_signals = contrarian_edge(sharp_rows, open_enriched)
    print_contrarian_signals(contrarian_signals)

    # ── 9. Copy signals (with Kelly sizing) ───────────────────────────────────
    print("\n[9/9] Building copy-trade signals (with Kelly sizing)...")

    # Deduplicate sybils from signal sources
    mp_clean  = deduplicate_sybil_signals(mp_wallets, sybil_clusters)
    t50_clean = deduplicate_sybil_signals(top50, sybil_clusters)

    # Primary: multi-period wallets (highest confidence)
    mp_signals = build_copy_signals(mp_clean, open_enriched, label="multi_period")
    mp_signals = allocate_budget(mp_signals, COPY_BUDGET)
    mp_signals = allocate_budget_kelly(mp_signals, COPY_BUDGET)

    # Fallback: top-50 profitable active wallets
    t50_signals = build_copy_signals(t50_clean, open_enriched, label="top50_profitable")
    t50_signals = allocate_budget(t50_signals, COPY_BUDGET)
    t50_signals = allocate_budget_kelly(t50_signals, COPY_BUDGET)

    if mp_signals:
        print_copy_signals(mp_signals, source_label="Multi-Period Consistent Wallets (★ primary)")
    else:
        print("\n  [!] No multi-period signals — falling back to top-50 wallets.")

    if t50_signals:
        print_copy_signals(t50_signals, source_label="Top-50 Profitable Active Wallets (fallback)")
    elif not mp_signals:
        print_market_strategy(open_enriched)

    # Save signals (including new analysis)
    all_signals = mp_signals + [s for s in t50_signals if s not in mp_signals]
    with open("copy_signals.json", "w") as f:
        json.dump(all_signals, f, indent=2, default=str)
    print(f"\nSignals saved → copy_signals.json  "
          f"({len(mp_signals)} multi-period  |  {len(t50_signals)} top-50)")

    # Save advanced analysis
    advanced = {
        "generated_at":         now_str,
        "sybil_clusters":       sybil_clusters,
        "convergence_events":   convergence_events,
        "exit_signals":         exit_signals,
        "contrarian_signals":   contrarian_signals,
    }
    with open("advanced_signals.json", "w") as f:
        json.dump(advanced, f, indent=2, default=str)
    print("Advanced analysis saved → advanced_signals.json\n")

    # Always show market overview at end
    print_market_strategy(open_enriched)

    # ── Optional: alerts + watchlist (if modules available) ───────────────────
    try:
        import alerts as alert_mod
        import watchlist as wl_mod

        cfg = alert_mod.load_config()
        wl_hits = wl_mod.check_watchlist(all_rows, market_titles)
        wl_mod.print_watchlist_hits(wl_hits)

        alert_mod.dispatch_alerts(
            cfg                = cfg,
            copy_signals       = all_signals,
            convergence_events = convergence_events,
            exit_signals       = exit_signals,
            contrarian_signals = contrarian_signals,
            market_titles      = market_titles,
            watchlist_hits     = wl_hits,
        )
    except ImportError:
        pass  # alerts/watchlist not required to run the analysis


if __name__ == "__main__":
    main()
