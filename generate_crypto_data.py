#!/usr/bin/env python3
"""
generate_crypto_data.py
────────────────────────
Fetches Polymarket BTC / ETH / SOL price-prediction market data and writes
data/crypto_data.json for the crypto dashboard to consume.

Run by GitHub Actions on a schedule — no CORS issues.
"""

import requests, json, time, os, re
from collections import defaultdict
from datetime import datetime, timezone

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API  = "https://clob.polymarket.com"
SUBGRAPH  = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

MIN_TRADES         = 5
TOP_PROFITABLE     = 50
ACTIVE_WINDOW_DAYS = 60
MIN_WALLETS_SIGNAL = 2
COPY_SUCCESS_RATE  = 0.82
COPY_BUDGET        = 100.0
RATE_DELAY         = 0.25
WEBHOOK_URL        = os.environ.get("WEBHOOK_URL", "")

# ── Coin config ────────────────────────────────────────────────
COINS = {
    "BTC": {
        "keywords": ["bitcoin", "btc"],
        "search_terms": ["bitcoin price", "btc price", "bitcoin above", "btc above",
                         "bitcoin 2025", "btc 2026", "bitcoin ath"],
        "color": "#f7931a",
        "icon": "₿",
    },
    "ETH": {
        "keywords": ["ethereum", "eth"],
        "search_terms": ["ethereum price", "eth price", "ethereum above", "eth above",
                         "ethereum 2025", "eth 2026", "ethereum ath"],
        "color": "#627eea",
        "icon": "Ξ",
    },
    "SOL": {
        "keywords": ["solana", "sol price", "sol above"],
        "search_terms": ["solana price", "sol price", "solana above", "solana 2025",
                         "sol 2026", "solana ath"],
        "color": "#9945ff",
        "icon": "◎",
    },
}

PERIODS = {
    "jun_2025": (int(datetime(2025,6,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2025,6,30,23,59,59,tzinfo=timezone.utc).timestamp())),
    "feb_2026": (int(datetime(2026,2,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2026,2,28,23,59,59,tzinfo=timezone.utc).timestamp())),
    "mar_2026": (int(datetime(2026,3,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2026,3,31,23,59,59,tzinfo=timezone.utc).timestamp())),
}
REQUIRED_PERIODS  = {"feb_2026", "mar_2026"}
PERIOD_LABEL      = {"jun_2025": "Jun'25", "feb_2026": "Feb'26", "mar_2026": "Mar'26"}


# ── HTTP helpers ────────────────────────────────────────────────
def get(url, params=None, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i < retries - 1: time.sleep(2 ** i)
            else: print(f"  [warn] {url}: {e}")
    return None

def post_gql(query, variables=None):
    for i in range(3):
        try:
            r = requests.post(SUBGRAPH,
                              json={"query": query, "variables": variables or {}},
                              timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i < 2: time.sleep(2 ** i)
    return None

def ts_period(ts):
    for name, (s, e) in PERIODS.items():
        if s <= ts <= e: return name
    return None


# ── Market fetching ─────────────────────────────────────────────
def _market_matches_coin(title, slug, coin_key):
    text = f"{title} {slug}".lower()
    kws  = COINS[coin_key]["keywords"]
    return any(kw in text for kw in kws)

def _deduplicate_by_coin(markets_per_coin):
    """Remove a market from lower-priority coins if it belongs to a higher one."""
    # Priority: BTC > ETH > SOL
    assigned = set()
    result   = {}
    for coin in ["BTC", "ETH", "SOL"]:
        clean = []
        for m in markets_per_coin.get(coin, []):
            mid = m.get("conditionId") or m.get("id")
            if mid not in assigned:
                clean.append(m)
                assigned.add(mid)
        result[coin] = clean
    return result

def find_crypto_markets():
    print("Fetching crypto markets…")
    raw_per_coin = {c: {} for c in COINS}

    for coin, cfg in COINS.items():
        for term in cfg["search_terms"]:
            for closed in ("false", "true"):
                data = get(f"{GAMMA_API}/markets",
                           {"q": term, "closed": closed, "limit": 100})
                if not data: continue
                batch = data if isinstance(data, list) else data.get("markets", [])
                for m in batch:
                    cid   = m.get("conditionId") or m.get("id")
                    title = (m.get("question") or m.get("title") or "").lower()
                    slug  = (m.get("slug") or "").lower()
                    if not cid: continue
                    if _market_matches_coin(title, slug, coin):
                        raw_per_coin[coin][cid] = m
                time.sleep(RATE_DELAY)

    markets_per_coin = {c: list(v.values()) for c, v in raw_per_coin.items()}
    markets_per_coin = _deduplicate_by_coin(markets_per_coin)

    for c, ms in markets_per_coin.items():
        print(f"  {c}: {len(ms)} markets")
    return markets_per_coin


# ── Trade fetching ──────────────────────────────────────────────
GQL = """query T($conds:[String!]!,$skip:Int!){fpmmTrades(first:1000 skip:$skip
  where:{fpmm_in:$conds} orderBy:creationTimestamp orderDirection:desc){
  id type creator{id} fpmm{id} outcomeTokensTraded collateralAmount creationTimestamp}}"""

def fetch_trades(condition_ids):
    if not condition_ids: return []
    print(f"  Fetching trades for {len(condition_ids)} markets (subgraph)…")
    all_trades, skip = [], 0
    while True:
        res    = post_gql(GQL, {"conds": condition_ids, "skip": skip})
        trades = (res or {}).get("data", {}).get("fpmmTrades", [])
        if not trades: break
        all_trades.extend(trades)
        print(f"    {len(all_trades)} trades…", end="\r")
        if len(trades) < 1000: break
        skip += 1000
        time.sleep(RATE_DELAY)
    print(f"\n    {len(all_trades)} total")
    return all_trades

def fetch_trades_clob(market_ids):
    all_trades = []
    for mid in market_ids[:40]:
        data = get(f"{CLOB_API}/trades", {"market": mid, "limit": 500})
        if not data: continue
        trades = data if isinstance(data, list) else data.get("data", [])
        for t in trades: t["_market"] = mid
        all_trades.extend(trades)
        time.sleep(RATE_DELAY)
    print(f"    {len(all_trades)} total (CLOB fallback)")
    return all_trades


# ── Wallet aggregation ──────────────────────────────────────────
def new_wallet():
    return dict(trades=0, buys=0, sells=0, gross_in=0.0, gross_out=0.0,
                profitable_exits=0, unprofitable_exits=0,
                first_trade=None, last_trade=None,
                period_flags=set(), period_pnl={}, positions={},
                closed_positions=[], all_closed=[])

def tag_period(w, ts, cost, is_buy):
    p = ts_period(ts)
    if not p: return
    w["period_flags"].add(p)
    pp = w["period_pnl"].setdefault(p, {"gross_in": 0.0, "gross_out": 0.0})
    if is_buy: pp["gross_in"] += cost
    else:      pp["gross_out"] += cost

def update_pos(w, mid, tokens, cost, is_buy):
    if not mid: return
    pos = w["positions"].setdefault(mid, {
        "net_tokens": 0.0, "total_cost": 0.0,
        "_buy_total": 0.0, "_sell_total": 0.0, "_recorded": False,
    })
    if is_buy:
        pos["net_tokens"] += tokens; pos["total_cost"] += cost
        pos["_buy_total"] += cost
    else:
        if pos["net_tokens"] > 0:
            ratio = min(tokens / pos["net_tokens"], 1.0)
            pos["total_cost"] -= pos["total_cost"] * ratio
        pos["net_tokens"]  = max(0.0, pos["net_tokens"] - tokens)
        pos["_sell_total"] += cost
        if pos["net_tokens"] <= 0.1 and pos["_buy_total"] > 0 and not pos["_recorded"]:
            pnl_pct = (pos["_sell_total"] - pos["_buy_total"]) / pos["_buy_total"] * 100
            w["all_closed"].append({"pnl_pct": round(pnl_pct, 1), "buy_cost": round(pos["_buy_total"], 2)})
            if pnl_pct >= 80.0:
                w["closed_positions"].append({
                    "market_id":    mid,
                    "buy_cost":     round(pos["_buy_total"], 2),
                    "proceeds":     round(pos["_sell_total"], 2),
                    "pnl_pct":      round(pnl_pct, 1),
                    "market_title": "",
                })
            pos["_recorded"] = True

def aggregate_subgraph(trades):
    wallets = defaultdict(new_wallet)
    for t in trades:
        addr = (t.get("creator") or {}).get("id", "").lower()
        if not addr: continue
        w   = wallets[addr]; w["trades"] += 1
        ts  = int(t.get("creationTimestamp", 0))
        col = int(t.get("collateralAmount", 0)) / 1e6
        tok = int(t.get("outcomeTokensTraded", 0)) / 1e6
        mid = (t.get("fpmm") or {}).get("id", "")
        tp  = (t.get("type") or "").upper()
        if not w["first_trade"] or ts < w["first_trade"]: w["first_trade"] = ts
        if not w["last_trade"]  or ts > w["last_trade"]:  w["last_trade"]  = ts
        if tp == "BUY":
            w["buys"] += 1; w["gross_in"] += col
            tag_period(w, ts, col, True); update_pos(w, mid, tok, col, True)
        elif tp == "SELL":
            w["sells"] += 1; w["gross_out"] += col
            tag_period(w, ts, col, False); update_pos(w, mid, tok, col, False)
            if tok > 0:
                price = col / tok
                if price >= 0.5: w["profitable_exits"] += 1
                else:            w["unprofitable_exits"] += 1
    return wallets

def aggregate_clob(trades):
    wallets = defaultdict(new_wallet)
    for t in trades:
        for af, sf in [("maker_address", "maker_side"), ("taker_address", "taker_side")]:
            addr = (t.get(af) or "").lower()
            if not addr or addr == "0x" + "0" * 40: continue
            w      = wallets[addr]; w["trades"] += 1
            ts_raw = t.get("timestamp") or t.get("created_at") or 0
            ts     = int(ts_raw) if str(ts_raw).isdigit() else 0
            price  = float(t.get("price", 0) or 0)
            size   = float(t.get("size", 0)  or 0)
            side   = (t.get(sf) or t.get("side") or "").upper()
            mid    = t.get("_market", "")
            cost   = price * size
            if ts:
                if not w["first_trade"] or ts < w["first_trade"]: w["first_trade"] = ts
                if not w["last_trade"]  or ts > w["last_trade"]:  w["last_trade"]  = ts
            if side == "BUY":
                w["buys"] += 1; w["gross_in"] += cost
                tag_period(w, ts, cost, True); update_pos(w, mid, size, cost, True)
            elif side == "SELL":
                w["sells"] += 1; w["gross_out"] += cost
                tag_period(w, ts, cost, False); update_pos(w, mid, size, cost, False)
                if price >= 0.5: w["profitable_exits"] += 1
                else:            w["unprofitable_exits"] += 1
    return wallets


# ── Scoring ─────────────────────────────────────────────────────
def score_wallets(wallets):
    now  = int(time.time())
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < MIN_TRADES: continue
        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = round(w["profitable_exits"] / exits * 100, 1) if exits else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]
        span     = (w["last_trade"] - w["first_trade"]) \
                   if w["first_trade"] and w["last_trade"] else 0
        act_days = max(1, span // 86400)
        last_ago = (now - (w["last_trade"] or 0)) // 86400 if w["last_trade"] else 9999
        flags    = w["period_flags"]
        pnl_by_p = {p: round(pp["gross_out"] - pp["gross_in"], 2)
                    for p, pp in w["period_pnl"].items()}
        losses       = [c["pnl_pct"] for c in w.get("all_closed", []) if c["pnl_pct"] < 0]
        max_loss_pct = round(min(losses), 1) if losses else 0.0
        open_positions = {
            mid: {"net_tokens": round(p["net_tokens"], 4), "total_cost": round(p["total_cost"], 4)}
            for mid, p in w["positions"].items() if p["net_tokens"] > 0.5
        }
        rows.append({
            "address":             addr,
            "trades":              w["trades"],
            "buys":                w["buys"],
            "sells":               w["sells"],
            "win_rate":            win_rate,
            "profitable_exits":    w["profitable_exits"],
            "total_exits":         exits,
            "net_pnl":             round(net_pnl, 2),
            "gross_in":            round(w["gross_in"], 2),
            "gross_out":           round(w["gross_out"], 2),
            "trades_per_day":      round(w["trades"] / act_days, 1),
            "active_days":         act_days,
            "last_ago":            last_ago,
            "is_active":           last_ago <= ACTIVE_WINDOW_DAYS,
            "period_flags":        list(flags),
            "period_score":        len(flags),
            "period_pnl":          pnl_by_p,
            "positions":           open_positions,
            "closed_positions_80": w["closed_positions"],
            "max_loss_pct":        max_loss_pct,
            "latest_bets":         [],
        })
    rows.sort(key=lambda r: (-r["win_rate"], -r["net_pnl"]))
    return rows

def get_mp(rows):
    q = [r for r in rows
         if REQUIRED_PERIODS.issubset(set(r["period_flags"])) and r["net_pnl"] > 0]
    return sorted(q, key=lambda r: (-r["period_score"], -r["net_pnl"]))

def get_top50(rows):
    a = [r for r in rows if r["is_active"] and r["net_pnl"] > 0]
    return sorted(a, key=lambda r: -r["net_pnl"])[:TOP_PROFITABLE]


# ── Live prices ─────────────────────────────────────────────────
def enrich_odds(markets):
    open_mkts = [m for m in markets if not m.get("closed") and not m.get("resolved")]
    out = []
    for m in open_mkts:
        yes_price  = None
        prices_raw = m.get("outcomePrices") or []
        if prices_raw:
            try: yes_price = float(prices_raw[0])
            except: pass
        if yes_price is None:
            token_ids = [(o.get("token_id") or o.get("tokenId", ""))
                         for o in (m.get("tokens") or [])]
            token_ids = [t for t in token_ids if t]
            if token_ids:
                book = get(f"{CLOB_API}/book", {"token_id": token_ids[0]})
                if book:
                    bids = book.get("bids") or []
                    if bids:
                        try: yes_price = float(bids[0].get("price", 0))
                        except: pass
        title = m.get("question") or m.get("title") or m.get("slug", "Unknown")
        out.append({
            "title":     title,
            "yes_price": yes_price,
            "volume":    float(m.get("volume") or m.get("volumeNum") or 0),
            "market_id": m.get("conditionId") or m.get("id") or "",
            "slug":      m.get("slug") or "",
        })
        time.sleep(RATE_DELAY)
    return out

def enrich_latest_bets(rows, open_enriched):
    mid_to_mkt = {m["market_id"]: m for m in open_enriched}
    for row in rows:
        bets = []
        for mid, pos in row.get("positions", {}).items():
            mkt = mid_to_mkt.get(mid)
            if not mkt: continue
            net_tokens = pos["net_tokens"]
            total_cost = pos["total_cost"]
            avg_price  = round(total_cost / net_tokens, 4) if net_tokens > 0 else 0
            cur_price  = mkt.get("yes_price")
            unrealized = round((cur_price - avg_price) * net_tokens, 2) \
                         if cur_price is not None else None
            bets.append({
                "market_id":      mid,
                "market_title":   mkt["title"],
                "tokens":         round(net_tokens, 2),
                "avg_price":      avg_price,
                "cost":           round(total_cost, 2),
                "current_price":  cur_price,
                "unrealized_pnl": unrealized,
            })
        row["latest_bets"] = sorted(bets, key=lambda b: b["tokens"], reverse=True)


# ── Signals ─────────────────────────────────────────────────────
def build_signals(source, open_mkts, label):
    signals = []
    for mkt in open_mkts:
        mid = mkt["market_id"]
        if not mid or mkt["yes_price"] is None: continue
        holders = []
        for w in source:
            pos = w["positions"].get(mid)
            if not pos or pos["net_tokens"] <= 0.5: continue
            avg_entry = (pos["total_cost"] / pos["net_tokens"]
                         if pos["net_tokens"] > 0 else mkt["yes_price"])
            holders.append({
                "address":      w["address"],
                "netTokens":    round(pos["net_tokens"], 2),
                "avgEntry":     round(avg_entry, 4),
                "netPnl":       w["net_pnl"],
                "winRate":      w["win_rate"],
                "periodScore":  w["period_score"],
                "period_flags": w["period_flags"],
            })
        if len(holders) < MIN_WALLETS_SIGNAL: continue
        total_tok  = sum(h["netTokens"] for h in holders)
        total_cost = sum(h["avgEntry"] * h["netTokens"] for h in holders)
        avg_entry  = total_cost / total_tok if total_tok > 0 else mkt["yes_price"]
        avg_ps     = sum(h["periodScore"] for h in holders) / len(holders)
        p          = mkt["yes_price"]
        ev         = COPY_SUCCESS_RATE * (1 - p) - (1 - COPY_SUCCESS_RATE) * p
        drift_pct  = round((p / avg_entry - 1) * 100, 1) if avg_entry > 0 else 0.0
        p_slip     = p * 1.02
        ev_slip    = COPY_SUCCESS_RATE * (1 - p_slip) - (1 - COPY_SUCCESS_RATE) * p_slip
        signals.append({
            "source":         label,
            "marketTitle":    mkt["title"],
            "marketSlug":     mkt.get("slug", ""),
            "yesPrice":       p,
            "volume":         mkt["volume"],
            "walletCount":    len(holders),
            "avgEntryPrice":  round(avg_entry, 4),
            "avgPeriodScore": round(avg_ps, 1),
            "ev":             round(ev, 4),
            "evSlippage":     round(ev_slip, 4),
            "driftPct":       drift_pct,
            "wallets":        sorted(holders, key=lambda h: -h["netPnl"]),
        })
    signals.sort(key=lambda s: (-s["avgPeriodScore"], -s["walletCount"], -s["ev"]))
    return signals

def allocate(signals):
    pos = [s for s in signals if s["ev"] > 0]
    if not pos: return []
    for s in pos:
        p = s["yesPrice"]
        b = (1.0 / p - 1.0) if p > 0 else 0.0
        if b > 0:
            k = (b * COPY_SUCCESS_RATE - (1.0 - COPY_SUCCESS_RATE)) / b
            s["kellyFraction"] = round(max(0.0, k * 0.25), 4)
        else:
            s["kellyFraction"] = 0.0
    total_kelly = sum(s["kellyFraction"] for s in pos)
    scale = min(1.0, 1.0 / total_kelly) if total_kelly > 0 else 1.0
    for s in pos:
        s["allocation"] = round(COPY_BUDGET * s["kellyFraction"] * scale, 2)
        s["shares"]     = round(s["allocation"] / s["yesPrice"], 1) if s["yesPrice"] > 0 else 0
        s["winPayout"]  = round(s["shares"], 2)
        s["netProfit"]  = round(s["winPayout"] - s["allocation"], 2)
    return pos

def apply_signal_age(signals, prev_signals):
    now      = int(time.time())
    prev_map = {s["marketTitle"]: s.get("firstSeen", now) for s in (prev_signals or [])}
    for s in signals:
        s["firstSeen"] = prev_map.get(s["marketTitle"], now)
        s["ageHours"]  = round((now - s["firstSeen"]) / 3600, 1)
    return signals

def detect_exit_signals(all_rows, open_enriched, prev_cache):
    if not prev_cache: return []
    mid_to_mkt  = {m["market_id"]: m for m in open_enriched}
    addr_to_row = {r["address"]: r for r in all_rows}
    exits = []
    for addr, prev_positions in prev_cache.items():
        row = addr_to_row.get(addr)
        if not row: continue
        curr_positions = row.get("positions", {})
        for mid, prev_tokens in prev_positions.items():
            if prev_tokens < 1.0: continue
            curr_pos    = curr_positions.get(mid, {})
            curr_tokens = curr_pos.get("net_tokens", 0.0) \
                          if isinstance(curr_pos, dict) else curr_pos
            reduction   = (prev_tokens - curr_tokens) / prev_tokens
            if reduction < 0.5: continue
            mkt = mid_to_mkt.get(mid)
            exits.append({
                "address":       addr,
                "market_id":     mid,
                "marketTitle":   mkt["title"] if mkt else mid[:40] + "…",
                "marketSlug":    mkt.get("slug", "") if mkt else "",
                "prevTokens":    round(prev_tokens, 2),
                "currTokens":    round(curr_tokens, 2),
                "reductionPct":  round(reduction * 100, 1),
                "walletPnl":     row["net_pnl"],
                "walletWinRate": row["win_rate"],
                "periodScore":   row["period_score"],
            })
    exits.sort(key=lambda e: (-e["reductionPct"], -e["walletPnl"]))
    return exits


# ── Format markets ──────────────────────────────────────────────
def format_markets(markets):
    out = []
    for m in markets:
        yes_price  = None
        prices_raw = m.get("outcomePrices") or []
        if prices_raw:
            try: yes_price = float(prices_raw[0])
            except: pass
        out.append({
            "id":        m.get("conditionId") or m.get("id", ""),
            "title":     m.get("question") or m.get("title") or m.get("slug", ""),
            "volume":    float(m.get("volume") or m.get("volumeNum") or 0),
            "closed":    bool(m.get("closed") or m.get("resolved")),
            "yes_price": yes_price,
            "slug":      m.get("slug", ""),
        })
    return out


# ── Webhook ──────────────────────────────────────────────────────
def send_webhook(coin, mp_sigs, t50_sigs, exit_sigs):
    if not WEBHOOK_URL: return
    lines    = []
    all_sigs = mp_sigs + [s for s in t50_sigs
                          if s["marketTitle"] not in {x["marketTitle"] for x in mp_sigs}]
    icon = COINS[coin]["icon"]
    if all_sigs:
        lines.append(f"{icon} *{coin} — {len(all_sigs)} copy signal(s)*")
        for s in all_sigs[:5]:
            tag      = "★" if s["source"] == "multi_period" else "·"
            ev_pct   = round(s["ev"] * 100, 1)
            slip_pct = round(s.get("evSlippage", s["ev"]) * 100, 1)
            lines.append(
                f"  {tag} {s['marketTitle'][:55]}  YES={s['yesPrice']:.2f}"
                f"  EV={ev_pct:+}¢  slippage={slip_pct:+}¢  ${s.get('allocation',0):.2f}"
            )
    if exit_sigs:
        lines.append(f"\n🚨 *{coin} exit signal(s)*")
        for e in exit_sigs[:3]:
            lines.append(f"  ↓{e['reductionPct']}% {e['marketTitle'][:50]}"
                         f"  (wallet P&L ${e['walletPnl']:+.0f})")
    if not lines: return
    try:
        requests.post(WEBHOOK_URL, json={"text": "\n".join(lines)}, timeout=10)
        print(f"  Webhook sent ({coin})")
    except Exception as e:
        print(f"  [warn] Webhook failed: {e}")


# ── Main ─────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print(f"  Crypto Data Generator — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    prev_data = {}
    try:
        with open("data/crypto_data.json") as f:
            prev_data = json.load(f)
        print("  Loaded previous data for exit/age tracking")
    except Exception:
        pass

    markets_per_coin = find_crypto_markets()
    all_markets_flat = [m for ms in markets_per_coin.values() for m in ms]

    if not all_markets_flat:
        print("[!] No crypto markets found — preserving existing data/crypto_data.json")
        return

    # Collect all condition IDs across all coins for one big trade fetch
    all_cids = list({m.get("conditionId") or m.get("id")
                     for m in all_markets_flat
                     if m.get("conditionId") or m.get("id")})

    trades = fetch_trades(all_cids)
    if not trades:
        mids = [m.get("id") or m.get("conditionId") for m in all_markets_flat
                if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(mids)

    print("Aggregating wallets (all crypto markets)…")
    raw      = (aggregate_subgraph(trades)
                if (trades and "creator" in trades[0])
                else aggregate_clob(trades))
    all_rows = score_wallets(raw)
    print(f"  {len(all_rows)} unique wallets")

    # Global top lists (across all coins)
    mp_global    = get_mp(all_rows)
    top50_global = get_top50(all_rows)

    # Per-coin data ─────────────────────────────────────────────
    coins_data   = {}
    all_open_enr = []

    for coin, markets in markets_per_coin.items():
        print(f"\n── {coin} ──────────────────────────────────────────")
        if not markets:
            coins_data[coin] = {"markets": [], "open_enriched": [],
                                "mp_wallets": [], "top50": [],
                                "mp_signals": [], "t50_signals": [],
                                "exit_signals": []}
            continue

        # Per-coin condition IDs to find coin-specific wallets
        coin_cids = {m.get("conditionId") or m.get("id") for m in markets
                     if m.get("conditionId") or m.get("id")}

        # Filter rows to wallets active in this coin's markets
        coin_rows = [
            r for r in all_rows
            if any(mid in coin_cids for mid in r.get("positions", {}))
        ]
        print(f"  {len(coin_rows)} wallets active in {coin} markets")

        coin_mp    = get_mp(coin_rows)
        coin_top50 = get_top50(coin_rows)

        # Enrich title for closed positions
        mid_to_title = {m.get("conditionId") or m.get("id", ""):
                        m.get("question") or m.get("title") or m.get("slug", "")
                        for m in markets}
        for row in coin_rows:
            for cp in row.get("closed_positions_80", []):
                cp["market_title"] = mid_to_title.get(cp["market_id"],
                                                      cp["market_id"][:20] + "…")

        print(f"  Fetching live prices…")
        open_enr = enrich_odds(markets)
        all_open_enr.extend(open_enr)

        enrich_latest_bets(coin_rows, open_enr)

        prev_coin_sigs = (prev_data.get("coins", {})
                                   .get(coin, {})
                                   .get("mp_signals", [])
                          + prev_data.get("coins", {})
                                     .get(coin, {})
                                     .get("t50_signals", []))

        mp_sigs  = apply_signal_age(allocate(build_signals(coin_mp,    open_enr, "multi_period")), prev_coin_sigs)
        t50_sigs = apply_signal_age(allocate(build_signals(coin_top50, open_enr, "top50")),        prev_coin_sigs)
        print(f"  {len(mp_sigs)} mp signals  |  {len(t50_sigs)} top50 signals")

        prev_cache   = (prev_data.get("coins", {})
                                 .get(coin, {})
                                 .get("positions_cache", {}))
        exit_signals = detect_exit_signals(coin_rows, open_enr, prev_cache)
        print(f"  {len(exit_signals)} exit signals")

        send_webhook(coin, mp_sigs, t50_sigs, exit_signals)

        positions_cache = {
            r["address"]: {mid: pos["net_tokens"]
                           for mid, pos in r["positions"].items()}
            for r in coin_rows[:200] if r.get("positions")
        }

        coins_data[coin] = {
            "markets":         format_markets(markets),
            "open_enriched":   open_enr,
            "mp_wallets":      [{k: v for k, v in r.items() if k != "positions"}
                                for r in coin_mp],
            "top50":           [{k: v for k, v in r.items() if k != "positions"}
                                for r in coin_top50],
            "mp_signals":      mp_sigs,
            "t50_signals":     t50_sigs,
            "exit_signals":    exit_signals,
            "positions_cache": positions_cache,
        }

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "coins":        coins_data,
        "coin_meta":    {c: {"color": v["color"], "icon": v["icon"]}
                         for c, v in COINS.items()},
    }

    os.makedirs("data", exist_ok=True)
    with open("data/crypto_data.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"\n✓ data/crypto_data.json written ({os.path.getsize('data/crypto_data.json')//1024} KB)")


if __name__ == "__main__":
    main()
