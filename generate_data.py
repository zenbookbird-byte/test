#!/usr/bin/env python3
"""
generate_data.py
────────────────
Fetches Polymarket Iran/US/Israel war market data and writes
data/war_data.json for the dashboard to consume.

Run by GitHub Actions on a schedule — no CORS issues.
"""

import requests, json, time, os, re
from collections import defaultdict
from datetime import datetime, timezone

GAMMA_API  = "https://gamma-api.polymarket.com"
CLOB_API   = "https://clob.polymarket.com"
SUBGRAPH   = "https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5"

MIN_TRADES         = 5
TOP_PROFITABLE     = 50
ACTIVE_WINDOW_DAYS = 60
MIN_WALLETS_SIGNAL = 2
COPY_SUCCESS_RATE  = 0.85
COPY_BUDGET        = 100.0
RATE_DELAY         = 0.2
WEBHOOK_URL        = os.environ.get("WEBHOOK_URL", "")  # Slack/Discord/Telegram webhook (optional)

WAR_KEYWORDS = [
    "iran","israel","hamas","hezbollah","war","strike","attack",
    "nuclear","missile","idf","irgc","us-iran","us iran","israel iran",
    "middle east","gaza","lebanon","tehran","netanyahu","khamenei",
]

PERIODS = {
    "jun_2025": (int(datetime(2025,6,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2025,6,30,23,59,59,tzinfo=timezone.utc).timestamp())),
    "feb_2026": (int(datetime(2026,2,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2026,2,28,23,59,59,tzinfo=timezone.utc).timestamp())),
    "mar_2026": (int(datetime(2026,3,1,tzinfo=timezone.utc).timestamp()),
                 int(datetime(2026,3,31,23,59,59,tzinfo=timezone.utc).timestamp())),
}
REQUIRED_PERIODS = {"feb_2026","mar_2026"}
PERIOD_LABEL = {"jun_2025":"Jun'25","feb_2026":"Feb'26","mar_2026":"Mar'26"}


def get(url, params=None, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i < retries-1: time.sleep(2**i)
            else: print(f"  [warn] {url}: {e}")
    return None

def post_gql(query, variables=None):
    for i in range(3):
        try:
            r = requests.post(SUBGRAPH, json={"query":query,"variables":variables or {}}, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i < 2: time.sleep(2**i)
    return None

def ts_period(ts):
    for name,(s,e) in PERIODS.items():
        if s <= ts <= e: return name
    return None


# ── Markets ────────────────────────────────────────────────────
_WAR_EXACT = [kw for kw in WAR_KEYWORDS if kw != "war"]

def _market_is_war(title, slug):
    """Return True only for genuine war/conflict markets (avoids hardware/warriors/etc)."""
    text = f"{title} {slug}"
    if any(kw in text for kw in _WAR_EXACT):
        return True
    return bool(re.search(r'\bwar\b', text))

def find_war_markets():
    print("Fetching markets…")
    markets, seen = [], set()
    for term in ["iran israel","iran war","israel attack","us iran","middle east war"]:
        for closed in ("false","true"):
            data = get(f"{GAMMA_API}/markets", {"q":term,"closed":closed,"limit":100})
            if not data: continue
            batch = data if isinstance(data,list) else data.get("markets",[])
            for m in batch:
                cid = m.get("conditionId") or m.get("id")
                title = (m.get("question") or m.get("title") or "").lower()
                slug  = (m.get("slug") or "").lower()
                if not cid or cid in seen: continue
                if _market_is_war(title, slug):
                    markets.append(m); seen.add(cid)
            time.sleep(RATE_DELAY)
    print(f"  {len(markets)} markets found")
    return markets


# ── Trades ─────────────────────────────────────────────────────
GQL = """query T($conds:[String!]!,$skip:Int!){fpmmTrades(first:1000 skip:$skip
  where:{fpmm_in:$conds} orderBy:creationTimestamp orderDirection:desc){
  id type creator{id} fpmm{id} outcomeTokensTraded collateralAmount creationTimestamp}}"""

def fetch_trades(condition_ids):
    print("Fetching trades (subgraph)…")
    all_trades, skip = [], 0
    while True:
        res = post_gql(GQL, {"conds":condition_ids,"skip":skip})
        trades = (res or {}).get("data",{}).get("fpmmTrades",[])
        if not trades: break
        all_trades.extend(trades)
        print(f"  {len(all_trades)} trades…", end="\r")
        if len(trades) < 1000: break
        skip += 1000
        time.sleep(RATE_DELAY)
    print(f"\n  {len(all_trades)} total trades")
    return all_trades

def fetch_trades_clob(market_ids):
    print("Fetching trades (CLOB fallback)…")
    all_trades = []
    for mid in market_ids[:30]:
        data = get(f"{CLOB_API}/trades", {"market":mid,"limit":500})
        if not data: continue
        trades = data if isinstance(data,list) else data.get("data",[])
        for t in trades: t["_market"] = mid
        all_trades.extend(trades)
        time.sleep(RATE_DELAY)
    print(f"  {len(all_trades)} total trades")
    return all_trades


# ── Aggregate ──────────────────────────────────────────────────
def new_wallet():
    return dict(trades=0,buys=0,sells=0,gross_in=0.0,gross_out=0.0,
                profitable_exits=0,unprofitable_exits=0,
                first_trade=None,last_trade=None,
                period_flags=set(),period_pnl={},positions={},
                closed_positions=[],all_closed=[])

def tag_period(w, ts, cost, is_buy):
    p = ts_period(ts)
    if not p: return
    w["period_flags"].add(p)
    pp = w["period_pnl"].setdefault(p, {"gross_in":0.0,"gross_out":0.0})
    if is_buy: pp["gross_in"] += cost
    else:      pp["gross_out"] += cost

def update_pos(w, mid, tokens, cost, is_buy):
    if not mid: return
    pos = w["positions"].setdefault(mid, {
        "net_tokens":0.0,"total_cost":0.0,
        "_buy_total":0.0,"_sell_total":0.0,"_recorded":False,
    })
    if is_buy:
        pos["net_tokens"] += tokens; pos["total_cost"] += cost
        pos["_buy_total"] += cost
    else:
        if pos["net_tokens"] > 0:
            ratio = min(tokens/pos["net_tokens"], 1.0)
            pos["total_cost"] -= pos["total_cost"] * ratio
        pos["net_tokens"] = max(0.0, pos["net_tokens"] - tokens)
        pos["_sell_total"] += cost
        # Detect fully-closed position
        if pos["net_tokens"] <= 0.1 and pos["_buy_total"] > 0 and not pos["_recorded"]:
            pnl_pct = (pos["_sell_total"] - pos["_buy_total"]) / pos["_buy_total"] * 100
            w["all_closed"].append({"pnl_pct": round(pnl_pct, 1), "buy_cost": round(pos["_buy_total"], 2)})
            if pnl_pct >= 80.0:
                w["closed_positions"].append({
                    "market_id":    mid,
                    "buy_cost":     round(pos["_buy_total"], 2),
                    "proceeds":     round(pos["_sell_total"], 2),
                    "pnl_pct":      round(pnl_pct, 1),
                    "market_title": "",  # enriched later
                })
            pos["_recorded"] = True

def aggregate_subgraph(trades):
    wallets = defaultdict(new_wallet)
    for t in trades:
        addr = (t.get("creator") or {}).get("id","").lower()
        if not addr: continue
        w = wallets[addr]; w["trades"] += 1
        ts  = int(t.get("creationTimestamp",0))
        col = int(t.get("collateralAmount",0))/1e6
        tok = int(t.get("outcomeTokensTraded",0))/1e6
        mid = (t.get("fpmm") or {}).get("id","")
        tp  = (t.get("type") or "").upper()
        if not w["first_trade"] or ts < w["first_trade"]: w["first_trade"] = ts
        if not w["last_trade"]  or ts > w["last_trade"]:  w["last_trade"]  = ts
        if tp == "BUY":
            w["buys"]+=1; w["gross_in"]+=col
            tag_period(w,ts,col,True); update_pos(w,mid,tok,col,True)
        elif tp == "SELL":
            w["sells"]+=1; w["gross_out"]+=col
            tag_period(w,ts,col,False); update_pos(w,mid,tok,col,False)
            if tok > 0:
                price = col/tok
                if price >= 0.5: w["profitable_exits"]+=1
                else:            w["unprofitable_exits"]+=1
    return wallets

def aggregate_clob(trades):
    wallets = defaultdict(new_wallet)
    for t in trades:
        for af,sf in [("maker_address","maker_side"),("taker_address","taker_side")]:
            addr = (t.get(af) or "").lower()
            if not addr or addr == "0x"+"0"*40: continue
            w = wallets[addr]; w["trades"] += 1
            ts_raw = t.get("timestamp") or t.get("created_at") or 0
            ts     = int(ts_raw) if str(ts_raw).isdigit() else 0
            price  = float(t.get("price",0) or 0)
            size   = float(t.get("size",0)  or 0)
            side   = (t.get(sf) or t.get("side") or "").upper()
            mid    = t.get("_market","")
            cost   = price * size
            if ts:
                if not w["first_trade"] or ts < w["first_trade"]: w["first_trade"] = ts
                if not w["last_trade"]  or ts > w["last_trade"]:  w["last_trade"]  = ts
            if side == "BUY":
                w["buys"]+=1; w["gross_in"]+=cost
                tag_period(w,ts,cost,True); update_pos(w,mid,size,cost,True)
            elif side == "SELL":
                w["sells"]+=1; w["gross_out"]+=cost
                tag_period(w,ts,cost,False); update_pos(w,mid,size,cost,False)
                if price >= 0.5: w["profitable_exits"]+=1
                else:            w["unprofitable_exits"]+=1
    return wallets


# ── Score ──────────────────────────────────────────────────────
def score_wallets(wallets):
    now = int(time.time())
    rows = []
    for addr, w in wallets.items():
        if w["trades"] < MIN_TRADES: continue
        exits    = w["profitable_exits"] + w["unprofitable_exits"]
        win_rate = round(w["profitable_exits"]/exits*100,1) if exits else 0.0
        net_pnl  = w["gross_out"] - w["gross_in"]
        span     = (w["last_trade"]-w["first_trade"]) if w["first_trade"] and w["last_trade"] else 0
        act_days = max(1, span//86400)
        last_ago = (now - (w["last_trade"] or 0))//86400 if w["last_trade"] else 9999
        flags    = w["period_flags"]
        pnl_by_p = {p: round(pp["gross_out"]-pp["gross_in"],2) for p,pp in w["period_pnl"].items()}
        # Drawdown: worst single closed-position loss
        losses = [c["pnl_pct"] for c in w.get("all_closed", []) if c["pnl_pct"] < 0]
        max_loss_pct = round(min(losses), 1) if losses else 0.0
        open_positions = {
            mid: {"net_tokens": round(p["net_tokens"],4), "total_cost": round(p["total_cost"],4)}
            for mid, p in w["positions"].items() if p["net_tokens"] > 0.5
        }
        rows.append({
            "address":    addr,
            "trades":     w["trades"],
            "buys":       w["buys"],
            "sells":      w["sells"],
            "win_rate":   win_rate,
            "profitable_exits":   w["profitable_exits"],
            "total_exits":        exits,
            "net_pnl":    round(net_pnl,2),
            "gross_in":   round(w["gross_in"],2),
            "gross_out":  round(w["gross_out"],2),
            "trades_per_day": round(w["trades"]/act_days,1),
            "active_days":    act_days,
            "last_ago":   last_ago,
            "is_active":  last_ago <= ACTIVE_WINDOW_DAYS,
            "period_flags":   list(flags),
            "period_score":   len(flags),
            "period_pnl":     pnl_by_p,
            "positions":      open_positions,
            "closed_positions_80": w["closed_positions"],
            "max_loss_pct":        max_loss_pct,
            "latest_bets":    [],  # enriched after enrich_odds() runs
        })
    rows.sort(key=lambda r:(-r["win_rate"],-r["net_pnl"]))
    return rows


def enrich_latest_bets(rows, open_enriched):
    """Fill in latest_bets for each row using their open positions + live prices."""
    mid_to_mkt = {m["market_id"]: m for m in open_enriched}
    for row in rows:
        bets = []
        for mid, pos in row.get("positions", {}).items():
            mkt = mid_to_mkt.get(mid)
            if not mkt:
                continue
            net_tokens = pos["net_tokens"]
            total_cost = pos["total_cost"]
            avg_price  = round(total_cost / net_tokens, 4) if net_tokens > 0 else 0
            cur_price  = mkt.get("yes_price")
            unrealized = round((cur_price - avg_price) * net_tokens, 2) if cur_price is not None else None
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

def get_mp(rows):
    q = [r for r in rows
         if REQUIRED_PERIODS.issubset(set(r["period_flags"])) and r["net_pnl"]>0]
    return sorted(q, key=lambda r:(-r["period_score"],-r["net_pnl"]))

def get_top50(rows):
    a = [r for r in rows if r["is_active"] and r["net_pnl"]>0]
    return sorted(a, key=lambda r:-r["net_pnl"])[:TOP_PROFITABLE]


# ── Live prices ────────────────────────────────────────────────
def enrich_odds(markets):
    open_mkts = [m for m in markets if not m.get("closed") and not m.get("resolved")]
    out = []
    for m in open_mkts:
        yes_price = None
        prices_raw = m.get("outcomePrices") or []
        if prices_raw:
            try: yes_price = float(prices_raw[0])
            except: pass
        if yes_price is None:
            token_ids = [(o.get("token_id") or o.get("tokenId","")) for o in (m.get("tokens") or [])]
            token_ids = [t for t in token_ids if t]
            if token_ids:
                book = get(f"{CLOB_API}/book", {"token_id": token_ids[0]})
                if book:
                    bids = book.get("bids") or []
                    if bids:
                        try: yes_price = float(bids[0].get("price",0))
                        except: pass
        title = m.get("question") or m.get("title") or m.get("slug","Unknown")
        out.append({
            "title":     title,
            "yes_price": yes_price,
            "volume":    float(m.get("volume") or m.get("volumeNum") or 0),
            "market_id": m.get("conditionId") or m.get("id") or "",
            "slug":      m.get("slug") or "",
        })
        time.sleep(RATE_DELAY)
    return out


# ── Signals ────────────────────────────────────────────────────
def build_signals(source, open_mkts, label):
    signals = []
    for mkt in open_mkts:
        mid = mkt["market_id"]
        if not mid or mkt["yes_price"] is None: continue
        holders = []
        for w in source:
            pos = w["positions"].get(mid)
            if not pos or pos["net_tokens"] <= 0.5: continue
            avg_entry = pos["total_cost"]/pos["net_tokens"] if pos["net_tokens"]>0 else mkt["yes_price"]
            holders.append({
                "address":     w["address"],
                "netTokens":   round(pos["net_tokens"],2),
                "avgEntry":    round(avg_entry,4),
                "netPnl":      w["net_pnl"],
                "winRate":     w["win_rate"],
                "periodScore": w["period_score"],
                "period_flags": w["period_flags"],
            })
        if len(holders) < MIN_WALLETS_SIGNAL: continue
        total_tok = sum(h["netTokens"] for h in holders)
        total_cost= sum(h["avgEntry"]*h["netTokens"] for h in holders)
        avg_entry = total_cost/total_tok if total_tok>0 else mkt["yes_price"]
        avg_ps    = sum(h["periodScore"] for h in holders)/len(holders)
        p  = mkt["yes_price"]
        ev = COPY_SUCCESS_RATE*(1-p) - (1-COPY_SUCCESS_RATE)*p
        drift_pct = round((p / avg_entry - 1) * 100, 1) if avg_entry > 0 else 0.0
        p_slip    = p * 1.02  # 2% slippage estimate
        ev_slip   = COPY_SUCCESS_RATE * (1 - p_slip) - (1 - COPY_SUCCESS_RATE) * p_slip
        signals.append({
            "source": label, "marketTitle": mkt["title"],
            "marketSlug": mkt.get("slug", ""),
            "yesPrice": p, "volume": mkt["volume"],
            "walletCount": len(holders),
            "avgEntryPrice": round(avg_entry,4),
            "avgPeriodScore": round(avg_ps,1),
            "ev": round(ev,4),
            "evSlippage": round(ev_slip, 4),
            "driftPct": drift_pct,
            "wallets": sorted(holders, key=lambda h:-h["netPnl"]),
        })
    signals.sort(key=lambda s:(-s["avgPeriodScore"],-s["walletCount"],-s["ev"]))
    return signals

def allocate(signals):
    """Kelly Criterion sizing (25% fractional Kelly), capped to COPY_BUDGET total."""
    pos = [s for s in signals if s["ev"] > 0]
    if not pos: return []

    for s in pos:
        p = s["yesPrice"]
        b = (1.0 / p - 1.0) if p > 0 else 0.0   # net odds: win (1-p) per p staked
        if b > 0:
            k = (b * COPY_SUCCESS_RATE - (1.0 - COPY_SUCCESS_RATE)) / b
            s["kellyFraction"] = round(max(0.0, k * 0.25), 4)  # 25% fractional Kelly
        else:
            s["kellyFraction"] = 0.0

    total_kelly = sum(s["kellyFraction"] for s in pos)
    # Scale down if total Kelly would exceed 100% of budget
    scale = min(1.0, 1.0 / total_kelly) if total_kelly > 0 else 1.0

    for s in pos:
        s["allocation"] = round(COPY_BUDGET * s["kellyFraction"] * scale, 2)
        s["shares"]     = round(s["allocation"] / s["yesPrice"], 1) if s["yesPrice"] > 0 else 0
        s["winPayout"]  = round(s["shares"], 2)
        s["netProfit"]  = round(s["winPayout"] - s["allocation"], 2)
    return pos


# ── Markets for display ────────────────────────────────────────
def format_markets(markets):
    out = []
    for m in markets:
        yes_price = None
        prices_raw = m.get("outcomePrices") or []
        if prices_raw:
            try: yes_price = float(prices_raw[0])
            except: pass
        out.append({
            "id":       m.get("conditionId") or m.get("id",""),
            "title":    m.get("question") or m.get("title") or m.get("slug",""),
            "volume":   float(m.get("volume") or m.get("volumeNum") or 0),
            "closed":   bool(m.get("closed") or m.get("resolved")),
            "yes_price": yes_price,
            "slug":     m.get("slug",""),
        })
    return out


# ── Signal age ─────────────────────────────────────────────────
def apply_signal_age(signals, prev_signals):
    """Stamp each signal with the Unix timestamp it was first seen."""
    now = int(time.time())
    prev_map = {s["marketTitle"]: s.get("firstSeen", now) for s in (prev_signals or [])}
    for s in signals:
        s["firstSeen"] = prev_map.get(s["marketTitle"], now)
        s["ageHours"]  = round((now - s["firstSeen"]) / 3600, 1)
    return signals


# ── Exit signals ────────────────────────────────────────────────
def detect_exit_signals(all_rows, open_enriched, prev_cache):
    """
    Compare current open positions to positions from the previous run.
    If a tracked wallet reduced a position by ≥50%, emit an exit signal.
    """
    if not prev_cache:
        return []
    mid_to_mkt = {m["market_id"]: m for m in open_enriched}
    addr_to_row = {r["address"]: r for r in all_rows}
    exits = []
    for addr, prev_positions in prev_cache.items():
        row = addr_to_row.get(addr)
        if not row:
            continue
        curr_positions = row.get("positions", {})
        for mid, prev_tokens in prev_positions.items():
            if prev_tokens < 1.0:
                continue
            curr_tokens = curr_positions.get(mid, {}).get("net_tokens", 0.0) \
                          if isinstance(curr_positions.get(mid), dict) \
                          else curr_positions.get(mid, 0.0)
            reduction = (prev_tokens - curr_tokens) / prev_tokens
            if reduction < 0.5:
                continue
            mkt = mid_to_mkt.get(mid)
            exits.append({
                "address":      addr,
                "market_id":    mid,
                "marketTitle":  mkt["title"] if mkt else mid[:40] + "…",
                "marketSlug":   mkt.get("slug", "") if mkt else "",
                "prevTokens":   round(prev_tokens, 2),
                "currTokens":   round(curr_tokens, 2),
                "reductionPct": round(reduction * 100, 1),
                "walletPnl":    row["net_pnl"],
                "walletWinRate":row["win_rate"],
                "periodScore":  row["period_score"],
            })
    exits.sort(key=lambda e: (-e["reductionPct"], -e["walletPnl"]))
    return exits


# ── Webhook ─────────────────────────────────────────────────────
def send_webhook(mp_sigs, t50_sigs, exit_sigs):
    if not WEBHOOK_URL:
        return
    lines = []
    all_sigs = mp_sigs + [s for s in t50_sigs if s["marketTitle"] not in {x["marketTitle"] for x in mp_sigs}]
    if all_sigs:
        lines.append(f"📡 *{len(all_sigs)} copy signal(s)*")
        for s in all_sigs[:5]:
            tag = "★" if s["source"] == "multi_period" else "·"
            ev_pct = round(s["ev"] * 100, 1)
            slip_pct = round(s.get("evSlippage", s["ev"]) * 100, 1)
            lines.append(f"  {tag} {s['marketTitle'][:60]}  YES={s['yesPrice']:.2f}  EV={ev_pct:+}¢  slippage={slip_pct:+}¢  ${s.get('allocation',0):.2f}")
    if exit_sigs:
        lines.append(f"\n🚨 *{len(exit_sigs)} exit signal(s)*")
        for e in exit_sigs[:5]:
            lines.append(f"  ↓{e['reductionPct']}% {e['marketTitle'][:55]}  (wallet P&L ${e['walletPnl']:+.0f})")
    if not lines:
        return
    payload = {"text": "\n".join(lines)}
    try:
        requests.post(WEBHOOK_URL, json=payload, timeout=10)
        print(f"  Webhook sent ({len(all_sigs)} signals, {len(exit_sigs)} exits)")
    except Exception as e:
        print(f"  [warn] Webhook failed: {e}")


# ── Main ───────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print(f"  War Data Generator — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # Load previous run's data for exit-signal detection and signal-age tracking
    prev_data = {}
    try:
        with open("data/war_data.json") as f:
            prev_data = json.load(f)
        print("  Loaded previous data for exit/age tracking")
    except Exception:
        pass

    markets = find_war_markets()
    # Guard: only proceed if we found at least one genuine war market
    # (keywords: iran, israel, nuclear, etc. — not just the word-boundary "war")
    genuine = [m for m in markets
               if any(kw in (m.get("question") or m.get("title") or "").lower()
                      or kw in (m.get("slug") or "").lower()
                      for kw in _WAR_EXACT)]
    if not genuine:
        print("[!] No genuine war markets found — preserving existing data/war_data.json")
        return
    if not markets:
        print("[!] No markets found")
        return

    condition_ids = list({m.get("conditionId") or m.get("id") for m in markets
                          if m.get("conditionId") or m.get("id")})

    trades = fetch_trades(condition_ids)
    if not trades:
        mids = [m.get("id") or m.get("conditionId") for m in markets
                if m.get("id") or m.get("conditionId")]
        trades = fetch_trades_clob(mids)

    print("Aggregating wallets…")
    raw = aggregate_subgraph(trades) if (trades and "creator" in trades[0]) else aggregate_clob(trades)
    print(f"  {len(raw)} unique wallets")

    all_rows = score_wallets(raw)

    # Enrich closed positions with market titles
    mid_to_title = {}
    for m in markets:
        mid   = m.get("conditionId") or m.get("id","")
        title = m.get("question") or m.get("title") or m.get("slug","")
        if mid: mid_to_title[mid] = title
    for row in all_rows:
        for cp in row.get("closed_positions_80", []):
            cp["market_title"] = mid_to_title.get(cp["market_id"], cp["market_id"][:20]+"…")

    mp       = get_mp(all_rows)
    top50    = get_top50(all_rows)
    print(f"  {len(mp)} multi-period  |  {len(top50)} top-50")

    print("Fetching live prices…")
    open_enriched = enrich_odds(markets)

    print("Enriching latest bets…")
    enrich_latest_bets(all_rows, open_enriched)

    prev_all_sigs = prev_data.get("mp_signals", []) + prev_data.get("t50_signals", [])
    mp_signals  = apply_signal_age(allocate(build_signals(mp,    open_enriched, "multi_period")), prev_all_sigs)
    t50_signals = apply_signal_age(allocate(build_signals(top50, open_enriched, "top50")),        prev_all_sigs)
    print(f"  {len(mp_signals)} multi-period signals  |  {len(t50_signals)} top-50 signals")

    # Exit signals: compare current open positions to previous run
    prev_cache   = prev_data.get("positions_cache", {})
    exit_signals = detect_exit_signals(all_rows, open_enriched, prev_cache)
    print(f"  {len(exit_signals)} exit signals detected")

    send_webhook(mp_signals, t50_signals, exit_signals)

    # Build positions cache for exit-signal detection on next run
    positions_cache = {
        r["address"]: {mid: pos["net_tokens"] for mid, pos in r["positions"].items()}
        for r in all_rows[:200] if r.get("positions")
    }

    data = {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "markets":         format_markets(markets),
        "open_enriched":   open_enriched,
        "wallet_rows":     [{k:v for k,v in r.items() if k!="positions"} for r in all_rows],
        "mp_wallets":      [{k:v for k,v in r.items() if k!="positions"} for r in mp],
        "top50":           [{k:v for k,v in r.items() if k!="positions"} for r in top50],
        "mp_signals":      mp_signals,
        "t50_signals":     t50_signals,
        "exit_signals":    exit_signals,
        "positions_cache": positions_cache,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/war_data.json","w") as f:
        json.dump(data, f, separators=(",",":"))
    print(f"\n✓ data/war_data.json written ({os.path.getsize('data/war_data.json')//1024} KB)")

if __name__ == "__main__":
    main()
