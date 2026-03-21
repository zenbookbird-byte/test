#!/usr/bin/env python3
"""
Polymarket Iran-War Profits Analyzer
Pulls on-chain trade data for Iran/Israel/war geopolitical markets and ranks wallets by win rate.

Usage:
    python3 polymarket_wallet_analysis.py          # live data
    python3 polymarket_wallet_analysis.py --demo   # offline preview with mock data
"""

import argparse
import csv
import json
import math
import os
import random
import sqlite3
import statistics
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

import requests


# ── Config ───────────────────────────────────────────────────────────────────
GAMMA_API  = "https://gamma-api.polymarket.com"
CLOB_API   = "https://clob.polymarket.com"
SUBGRAPH   = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

MIN_TRADES = 10   # wallets with fewer trades are filtered out
TOP_N      = 30   # rows to show in the terminal table
RATE_DELAY = 0.25 # seconds between API pages
CACHE_DIR  = ".cache"
CACHE_TTL  = 3600 # seconds before cached data is considered stale


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


def load_cache(filename: str, ttl: int = CACHE_TTL):
    """Return cached data if the file exists and is younger than *ttl* seconds."""
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
    """Persist *data* to a timestamped JSON cache file."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, filename)
    with open(path, "w") as f:
        json.dump({"_cached_at": time.time(), "data": data}, f)


def deduplicate_trades(trades: list) -> list:
    """Remove trades with duplicate IDs. Trades lacking an 'id' field are kept."""
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


# ── Step 1: Find Iran/war geopolitical markets ────────────────────────────────
_WAR_KEYWORDS = ("iran", "israel", "war", "nuclear", "strike", "attack", "missile", "idf", "irgc")
_WAR_FILTER   = ("iran", "israel", "war", "strike", "attack", "nuclear", "missile")


def find_war_markets(limit: int = 50) -> list:
    print("\n[1/4] Fetching Iran/Israel/war geopolitical markets from Gamma API...")
    markets, seen = [], set()

    for kw in _WAR_KEYWORDS:
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
                if any(t in title or t in slug for t in _WAR_FILTER):
                    markets.append(m)
                    seen.add(cid)
            page += 1
            if len(batch) < 100:
                break
            time.sleep(RATE_DELAY)

    print(f"  Found {len(markets)} Iran/war geopolitical markets.")
    return markets[:limit]


def _broader_war_search() -> list:
    """Widen search when the keyword filter yields nothing."""
    data = get(f"{GAMMA_API}/markets", params={"q": "iran israel", "limit": 100})
    if data is None:
        return []
    if isinstance(data, list):
        return data
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


# ── Step 2b: Group raw trades by wallet ───────────────────────────────────────
def group_trades_by_wallet(trades: list) -> dict:
    """Return {addr: [trade, ...]} preserving raw dicts for position matching."""
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
                price = collateral / tokens
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


# ── Analytics ─────────────────────────────────────────────────────────────────
def match_positions(trades: list) -> list:
    """FIFO buy-to-sell matching per market.

    Returns one dict per completed round trip with entry/exit price, size,
    P&L, hold time, and a won flag.
    """
    by_market = defaultdict(list)
    for t in sorted(trades, key=lambda x: _to_ts(x.get("creationTimestamp", 0))):
        mid = (t.get("fpmm") or {}).get("id", "") or t.get("_market", "unknown")
        by_market[mid].append(t)

    matched = []
    for market_id, market_trades in by_market.items():
        buy_queue = deque()
        for t in market_trades:
            ttype      = (t.get("type") or "").upper()
            collateral = _to_int(t.get("collateralAmount", 0)) / 1e6
            tokens     = _to_int(t.get("outcomeTokensTraded", 0)) / 1e6
            ts         = _to_ts(t.get("creationTimestamp", 0))
            if tokens == 0:
                continue
            price = collateral / tokens

            if ttype == "BUY":
                buy_queue.append({"price": price, "size": tokens, "ts": ts})
            elif ttype == "SELL" and buy_queue:
                buy  = buy_queue.popleft()
                size = min(buy["size"], tokens)
                pnl  = (price - buy["price"]) * size
                matched.append({
                    "market":      market_id,
                    "buy_ts":      buy["ts"],
                    "sell_ts":     ts,
                    "entry_price": buy["price"],
                    "exit_price":  price,
                    "size":        size,
                    "pnl":         pnl,
                    "hold_secs":   max(0, ts - buy["ts"]),
                    "won":         price > buy["price"],
                })
    return matched


def binomial_pvalue(wins: int, total: int) -> float:
    """One-sided p-value: P(X >= wins | p=0.5, n=total) via normal approximation.

    Small values (< 0.05) mean the win rate is unlikely to be random luck.
    """
    if total == 0:
        return 1.0
    # Continuity correction: subtract 0.5 from wins before standardising
    z = (wins - 0.5 - total * 0.5) / math.sqrt(total * 0.25)
    return max(0.0, min(1.0, math.erfc(z / math.sqrt(2)) / 2))


def ev_score(matched: list) -> float:
    """Expected value per unit of collateral risked (average across all trades).

    Positive = edge, negative = losing strategy on average.
    """
    if not matched:
        return 0.0
    wins   = [m for m in matched if m["won"]]
    losses = [m for m in matched if not m["won"]]
    n      = len(matched)

    def _norm(m):
        denom = m["entry_price"] * m["size"]
        return m["pnl"] / denom if denom else 0.0

    avg_win  = sum(_norm(m) for m in wins)  / len(wins)   if wins   else 0.0
    avg_loss = sum(_norm(m) for m in losses) / len(losses) if losses else 0.0
    win_rate  = len(wins)   / n
    loss_rate = len(losses) / n
    return round(win_rate * avg_win + loss_rate * avg_loss, 4)


def alpha_decay(matched: list) -> float:
    """Recent win rate / early win rate.

    < 1.0 means the edge is shrinking over time.
    > 1.0 means the wallet is improving.
    Returns 1.0 when there is not enough data to tell.
    """
    if len(matched) < 10:
        return 1.0
    sorted_m  = sorted(matched, key=lambda m: m["buy_ts"])
    mid       = len(sorted_m) // 2
    early     = sorted_m[:mid]
    recent    = sorted_m[mid:]
    early_wr  = sum(1 for m in early  if m["won"]) / len(early)
    recent_wr = sum(1 for m in recent if m["won"]) / len(recent)
    if early_wr == 0:
        return 1.0
    return round(recent_wr / early_wr, 3)


def hold_time_stats(matched: list) -> dict:
    """Median and mean hold time in seconds across all matched round trips."""
    if not matched:
        return {"median_hold_secs": 0, "mean_hold_secs": 0}
    holds = [m["hold_secs"] for m in matched]
    return {
        "median_hold_secs": int(statistics.median(holds)),
        "mean_hold_secs":   int(statistics.mean(holds)),
    }


# ── Step 4: Score & rank ──────────────────────────────────────────────────────
def detect_strategy(trades_per_day: float, active_days: int) -> str:
    if trades_per_day >= 100:
        return "bot"
    if trades_per_day >= 10:
        return "scalper"
    return "swing"


def score_wallets(wallets: dict, min_trades: int = MIN_TRADES,
                  trades_by_wallet: dict = None) -> list:
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < min_trades:
            continue

        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = (w["profitable_exits"] / exits * 100) if exits > 0 else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]

        if w["first_trade"] and w["last_trade"]:
            span_secs   = max(0, w["last_trade"] - w["first_trade"])
            active_days = max(1, math.ceil(span_secs / 86400))
        else:
            active_days = 1

        tpd = round(w["trades"] / active_days, 1)

        # Advanced analytics — only available when raw trades are passed in
        matched = []
        if trades_by_wallet and addr in trades_by_wallet:
            matched = match_positions(trades_by_wallet[addr])

        pvalue = binomial_pvalue(w["profitable_exits"], exits) if exits > 0 else 1.0
        ev     = ev_score(matched)
        decay  = alpha_decay(matched)
        hold   = hold_time_stats(matched)

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
            "trades_per_day":   tpd,
            "active_days":      active_days,
            "strategy":         detect_strategy(tpd, active_days),
            "ev_score":         ev,
            "pvalue":           round(pvalue, 4),
            "alpha_decay":      decay,
            "median_hold_secs": hold["median_hold_secs"],
            "mean_hold_secs":   hold["mean_hold_secs"],
            "cluster":          "",   # filled by cluster_wallets()
        })

    # Primary sort: EV score (true skill), then win rate, then net P&L
    rows.sort(key=lambda r: (r["ev_score"], r["win_rate"], r["net_pnl_usdc"]), reverse=True)
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
            label = "sharp"        # statistically significant, stable edge
        elif pv < 0.05 and ev > 0:
            label = "edge"         # likely skilled
        elif decay < 0.7:
            label = "fading"       # edge shrinking
        elif ev <= 0:
            label = "noise"        # negative expected value
        else:
            label = "developing"   # positive ev but not yet significant

        r["cluster"] = label
    return rows


# ── Step 5: Display ───────────────────────────────────────────────────────────
def print_table(rows: list, top_n: int = TOP_N, min_trades: int = MIN_TRADES):
    header = (
        f"{'#':<4} {'Address':<44} {'Trades':>7} {'T/day':>6} "
        f"{'Win%':>6} {'EV':>7} {'p-val':>6} {'Net P&L':>10} {'Cluster':>11}"
    )
    sep = "-" * len(header)
    print(f"\n[4/4] Top {min(top_n, len(rows))} wallets by EV score  (min {min_trades} trades)\n")
    print(sep)
    print(header)
    print(sep)

    for i, r in enumerate(rows[:top_n], 1):
        pnl_str = (f"+{r['net_pnl_usdc']:.2f}" if r["net_pnl_usdc"] >= 0
                   else f"{r['net_pnl_usdc']:.2f}")
        ev_str  = f"{r['ev_score']:+.4f}"
        pv_str  = f"{r['pvalue']:.4f}"
        print(
            f"{i:<4} {r['address']:<44} {r['trades']:>7} {r['trades_per_day']:>6.1f} "
            f"{r['win_rate']:>5.1f}% {ev_str:>7} {pv_str:>6} {pnl_str:>10} "
            f"{r.get('cluster', ''):>11}"
        )

    print(sep)
    print(f"\nShowing {min(top_n, len(rows))} of {len(rows)} qualifying wallets.\n")


def print_analysis(rows: list, n: int = 5):
    """Detailed single-wallet breakdown for the top N entries."""
    count = min(n, len(rows))
    print(f"── Top {count} Wallet Deep-Dive ──────────────────────────────────────")
    for i, r in enumerate(rows[:count], 1):
        hold_h  = r["median_hold_secs"] / 3600
        decay_s = f"{r['alpha_decay']:.2f}x"
        sig     = "SIGNIFICANT" if r["pvalue"] < 0.05 else "not significant"
        print(
            f"\n  #{i}  {r['address']}\n"
            f"       Cluster  : {r['cluster']:<12}  Strategy : {r['strategy']}\n"
            f"       EV/trade : {r['ev_score']:+.4f}       p-value  : {r['pvalue']:.4f}  ({sig})\n"
            f"       AlphaDecay: {decay_s:<9}      Med hold : {hold_h:.1f}h\n"
            f"       Win rate : {r['win_rate']:.1f}%  ({r['profitable_exits']}/{r['total_exits']} exits)"
            f"   Net P&L: ${r['net_pnl_usdc']:+.2f}"
        )
    print()


def save_json(rows: list, path: str = "wallet_rankings.json"):
    with open(path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"Full rankings saved to {path}")


def export_csv(rows: list, path: str = "wallet_rankings.csv"):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV exported to {path}")


def print_summary_stats(rows: list):
    if not rows:
        return
    win_rates = [r["win_rate"]     for r in rows]
    pnls      = [r["net_pnl_usdc"] for r in rows]
    volumes   = [r["gross_in_usdc"] for r in rows]
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
    print(f"  Mean win rate       : {statistics.mean(win_rates):.1f}%")
    print(f"  Median EV score     : {statistics.median(ev_scores):+.4f}")
    print(f"  Median net P&L      : ${statistics.median(pnls):+.2f}")
    print(f"  Total volume (in)   : ${sum(volumes):,.2f} USDC")
    print(f"  Cluster breakdown   : {clusters}")
    print("────────────────────────────────────────────────────────\n")


def snapshot_rankings(rows: list, db_path: str = "rankings_history.db"):
    """Append current rankings to a SQLite database for historical tracking."""
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
            cluster        TEXT
        )
    """)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    con.executemany(
        "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (ts, i, r["address"], r["trades"], r["win_rate"],
             r.get("ev_score", 0), r.get("pvalue", 1), r.get("alpha_decay", 1),
             r["net_pnl_usdc"], r["trades_per_day"], r["active_days"],
             r.get("strategy", ""), r.get("cluster", ""))
            for i, r in enumerate(rows, 1)
        ],
    )
    con.commit()
    con.close()
    print(f"Snapshot saved to {db_path} ({len(rows)} rows at {ts})")


# ── Demo mode (offline preview) ───────────────────────────────────────────────
def _fake_address(seed: int) -> str:
    rng = random.Random(seed)
    return "0x" + "".join(rng.choices("0123456789abcdef", k=40))


def _generate_demo_trades(n_wallets: int = 80, n_markets: int = 10) -> list:
    """Generate synthetic subgraph-format trades that exercise the full pipeline."""
    random.seed(42)
    now        = int(datetime.now(timezone.utc).timestamp())
    trades     = []
    trade_id   = 0
    market_ids = [_fake_address(1000 + i) for i in range(n_markets)]

    for wallet_idx in range(n_wallets):
        addr       = _fake_address(wallet_idx)
        is_bot     = wallet_idx < 5
        n_rounds   = random.randint(800, 2400) if is_bot else random.randint(10, 120)
        win_rate_t = random.uniform(0.78, 0.91) if is_bot else random.uniform(0.35, 0.68)
        span_days  = random.randint(7, 21)
        span_secs  = span_days * 86400
        first_ts   = now - span_secs
        # Some wallets exhibit alpha decay (edge fades over time)
        has_decay  = (not is_bot) and wallet_idx % 7 == 0

        for i in range(n_rounds):
            market    = random.choice(market_ids)
            entry_ts  = first_ts + random.randint(0, max(1, span_secs - 3600))
            hold_secs = random.randint(30, 900) if is_bot else random.randint(300, 7200)
            exit_ts   = entry_ts + hold_secs

            entry_price    = random.uniform(0.25, 0.38)
            size           = random.uniform(60, 100)
            collateral_in  = entry_price * size

            # Alpha decay: win rate falls linearly for flagged wallets
            progress     = i / n_rounds
            eff_wr       = win_rate_t * (1 - 0.5 * progress) if has_decay else win_rate_t
            won          = random.random() < eff_wr
            exit_price   = random.uniform(0.85, 0.98) if won else random.uniform(0.02, 0.15)
            collateral_out = exit_price * size

            trades.append({
                "id":                   f"t{trade_id:07d}",
                "type":                 "BUY",
                "creator":              {"id": addr},
                "fpmm":                 {"id": market},
                "outcomeIndex":         "0",
                "outcomeTokensTraded":  str(int(size * 1e6)),
                "collateralAmount":     str(int(collateral_in * 1e6)),
                "feeAmount":            "0",
                "creationTimestamp":    str(entry_ts),
            })
            trade_id += 1

            trades.append({
                "id":                   f"t{trade_id:07d}",
                "type":                 "SELL",
                "creator":              {"id": addr},
                "fpmm":                 {"id": market},
                "outcomeIndex":         "0",
                "outcomeTokensTraded":  str(int(size * 1e6)),
                "collateralAmount":     str(int(collateral_out * 1e6)),
                "feeAmount":            "0",
                "creationTimestamp":    str(exit_ts),
            })
            trade_id += 1

    return trades


def run_demo(top_n: int = TOP_N, min_trades: int = MIN_TRADES):
    """Generate realistic mock data so the output can be previewed offline."""
    print("\n[demo] Generating synthetic trade data for 80 wallets...\n")
    trades = _generate_demo_trades()
    print(f"  Generated {len(trades)} raw trades.")
    trades = deduplicate_trades(trades)

    print("[2/4] Grouping trades by wallet...")
    trades_by_wallet = group_trades_by_wallet(trades)

    print("[3/4] Aggregating wallet statistics...")
    wallets = aggregate_wallets_subgraph(trades)
    print(f"  Unique wallets: {len(wallets)}")

    ranked = score_wallets(wallets, min_trades=min_trades, trades_by_wallet=trades_by_wallet)
    cluster_wallets(ranked)
    print_table(ranked, top_n=top_n, min_trades=min_trades)
    print_analysis(ranked, n=5)
    print_summary_stats(ranked)
    save_json(ranked, "wallet_rankings_demo.json")
    export_csv(ranked, "wallet_rankings_demo.csv")
    snapshot_rankings(ranked, "rankings_history.db")
    print("(Demo mode — no real API calls were made.)\n")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Polymarket Iran-war geopolitical wallet profits analyzer")
    parser.add_argument("--demo",       action="store_true", help="Run offline with synthetic data")
    parser.add_argument("--top",        type=int, default=TOP_N,
                        help="Rows to display (default 30)")
    parser.add_argument("--min-trades", type=int, default=MIN_TRADES,
                        help="Minimum trades to include a wallet (default 10)")
    parser.add_argument("--no-cache",   action="store_true", help="Ignore cached API responses")
    args = parser.parse_args()

    top_n      = args.top
    min_trades = args.min_trades
    use_cache  = not args.no_cache

    print("=" * 60)
    print("  Polymarket Iran-War Profits Analyzer")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    if args.demo:
        run_demo(top_n=top_n, min_trades=min_trades)
        return

    # ── Live path ────────────────────────────────────────────────────────────
    markets = (load_cache("markets.json") if use_cache else None) or []
    if not markets:
        markets = find_war_markets()
        if markets and use_cache:
            save_cache(markets, "markets.json")

    if not markets:
        print("\n[!] No war markets found. Trying broader search...")
        markets = _broader_war_search()

    if not markets:
        print("[!] Could not reach Polymarket API. Run with --demo to preview output.")
        return

    print("\n  Sample markets:")
    for m in markets[:5]:
        title = m.get("question") or m.get("title") or m.get("slug", "?")
        print(f"    * {title}")

    condition_ids = extract_condition_ids(markets)
    print(f"\n  Condition IDs to query: {len(condition_ids)}")

    trades = (load_cache("trades.json") if use_cache else None) or []
    if not trades:
        trades = fetch_trades_subgraph(condition_ids) if condition_ids else []
        if trades and use_cache:
            save_cache(trades, "trades.json")

    if not trades:
        mids = [m.get("id") or m.get("conditionId") for m in markets
                if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(mids)

    if not trades:
        print("\n[!] No trade data retrieved. Run with --demo to preview output.")
        return

    trades = deduplicate_trades(trades)

    print("\n[3/4] Aggregating wallet statistics...")
    trades_by_wallet = group_trades_by_wallet(trades)
    wallets = (aggregate_wallets_subgraph(trades)
               if "creator" in trades[0]
               else aggregate_wallets_clob(trades))
    print(f"  Unique wallets found: {len(wallets)}")

    ranked = score_wallets(wallets, min_trades=min_trades, trades_by_wallet=trades_by_wallet)
    cluster_wallets(ranked)
    print_table(ranked, top_n=top_n, min_trades=min_trades)
    print_analysis(ranked, n=5)
    print_summary_stats(ranked)
    save_json(ranked)
    export_csv(ranked)
    snapshot_rankings(ranked)


if __name__ == "__main__":
    main()
