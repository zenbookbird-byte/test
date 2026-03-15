#!/usr/bin/env python3
"""
wallet_scout.py — Polymarket Profitable Wallet Finder
======================================================
Queries Polymarket's live on-chain data to find the most profitable wallets
on BTC, ETH, and SOL prediction markets.

HOW IT WORKS
------------
1. Finds all RESOLVED BTC/ETH/SOL markets on Polymarket (via Gamma API).
2. For each resolved market, checks which outcome won (YES or NO).
3. Queries the subgraph for every trade on those markets.
4. Calculates per-wallet P&L:
     - Bought the WINNING side → credited tokens * 1.00 - cost
     - Bought the LOSING side  → debited cost
5. Ranks wallets by: net P&L, win rate, consistency score.
6. Saves top-30 per coin to data/crypto_wallets.json.
7. Updates data/wallet_scores.json with history for the month tracker.

USAGE
-----
  python wallet_scout.py                  # scout all 3 coins
  python wallet_scout.py --coin BTC       # single coin
  python wallet_scout.py --top 50         # keep top 50 (default 30)
  python wallet_scout.py --days 60        # look back 60 days (default 90)
  python wallet_scout.py --min-trades 3   # lower min trades (default 5)

OUTPUT
------
  data/crypto_wallets.json   — wallets by coin (read by copy_trader.py)
  data/wallet_scores.json    — full ranking with scores (read by leaderboard)
"""

import argparse, json, os, sys, time, logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import requests

# ─────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('wallet_scout')

# ─────────────────────────────────────────────────────────────
#  Config
# ─────────────────────────────────────────────────────────────
GAMMA_API = 'https://gamma-api.polymarket.com'
SUBGRAPH   = 'https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5'

# Keyword sets per coin — broader is better (more markets = more data)
COIN_KEYWORDS = {
    'BTC': ['bitcoin', 'btc', 'bitcoin price', 'btc above', 'btc end', 'bitcoin 2025',
            'bitcoin 2026', 'bitcoin ath', 'bitcoin high', 'satoshi', 'bitcoin hit'],
    'ETH': ['ethereum', 'eth price', 'eth above', 'eth end', 'ethereum 2025',
            'ethereum 2026', 'ethereum ath', 'ethereum hit', 'ether price'],
    'SOL': ['solana', 'sol price', 'sol above', 'solana above', 'sol end',
            'solana 2025', 'solana 2026', 'solana ath', 'sol hit'],
}

# Defaults (all overridable from argparse)
DEFAULT_TOP         = 30
DEFAULT_DAYS        = 90    # look back window for market resolution
DEFAULT_MIN_TRADES  = 5     # wallet must have traded N+ markets to appear
DEFAULT_MIN_WINRATE = 0.50  # minimum win rate to keep a wallet

# ─────────────────────────────────────────────────────────────
#  HTTP helpers
# ─────────────────────────────────────────────────────────────
_session = requests.Session()
_session.headers.update({'User-Agent': 'polymarket-wallet-scout/1.0'})

def _get(url, **params):
    for attempt in range(3):
        try:
            r = _session.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                log.debug(f'GET {url} failed: {e}')
                return None
            time.sleep(1.0 * (attempt + 1))

def _gql(query, variables=None):
    for attempt in range(3):
        try:
            r = _session.post(
                SUBGRAPH,
                json={'query': query, 'variables': variables or {}},
                timeout=20,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                log.debug(f'GraphQL failed: {e}')
                return None
            time.sleep(1.5 * (attempt + 1))

# ─────────────────────────────────────────────────────────────
#  Step 1: Find resolved markets for a coin
# ─────────────────────────────────────────────────────────────
def fetch_resolved_markets(coin: str, days: int) -> list[dict]:
    """
    Return list of {id, conditionId, title, yes_won, volume_usdc}
    for markets that:
      - match the coin's keywords
      - are CLOSED (resolved)
      - resolved within the last `days` days
    """
    keywords = COIN_KEYWORDS[coin]
    cutoff_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())

    markets = []
    seen_ids = set()

    for term in keywords:
        page = 0
        while True:
            data = _get(
                f'{GAMMA_API}/markets',
                q=term,
                closed='true',
                limit=100,
                offset=page * 100,
            )
            if not data or not isinstance(data, list) or not data:
                break

            for m in data:
                mid = m.get('conditionId') or m.get('id')
                if not mid or mid in seen_ids:
                    continue

                # Check resolution timestamp is recent enough
                end_ts = m.get('endDate') or m.get('endDateIso')
                if end_ts:
                    try:
                        if isinstance(end_ts, str):
                            end_dt = datetime.fromisoformat(end_ts.replace('Z', '+00:00'))
                            end_unix = int(end_dt.timestamp())
                        else:
                            end_unix = int(end_ts)
                        if end_unix < cutoff_ts:
                            continue
                    except Exception:
                        pass

                # Determine winner from outcomePrices
                prices = m.get('outcomePrices', [])
                if len(prices) < 2:
                    continue
                try:
                    yes_price = float(prices[0])
                    no_price  = float(prices[1])
                except (ValueError, TypeError):
                    continue

                # Only count fully resolved (not 50/50 ambiguous)
                if yes_price >= 0.99:
                    yes_won = True
                elif no_price >= 0.99:
                    yes_won = False
                else:
                    continue   # unresolved or cancelled

                seen_ids.add(mid)
                volume = float(m.get('volumeNum') or m.get('volume') or 0)
                markets.append({
                    'id':           mid,
                    'fpmm_id':      m.get('id', mid),
                    'title':        m.get('title', ''),
                    'yes_won':      yes_won,
                    'volume_usdc':  volume,
                })

            if len(data) < 100:
                break
            page += 1
            time.sleep(0.2)

        time.sleep(0.3)

    log.info(f'  [{coin}] Found {len(markets)} resolved markets')
    return markets

# ─────────────────────────────────────────────────────────────
#  Step 2: Query all trades on those markets
# ─────────────────────────────────────────────────────────────
GQL_TRADES = """
query Trades($markets: [String!]!, $skip: Int!) {
  fpmmTrades(
    first: 1000
    skip: $skip
    where: { fpmm_in: $markets }
    orderBy: creationTimestamp
    orderDirection: asc
  ) {
    id
    type
    creator { id }
    fpmm { id }
    outcomeIndex
    outcomeTokensTraded
    collateralAmount
    creationTimestamp
  }
}
"""

def fetch_trades_for_markets(market_ids: list[str]) -> list[dict]:
    """
    Return all trades across all markets in `market_ids`.
    Paginates with skip to avoid the 1000-result limit.
    Batches market IDs in chunks of 50 to keep query size manageable.
    """
    all_trades = []
    CHUNK = 50

    for i in range(0, len(market_ids), CHUNK):
        chunk = market_ids[i:i + CHUNK]
        skip = 0
        while True:
            res = _gql(GQL_TRADES, {'markets': chunk, 'skip': skip})
            trades = res.get('data', {}).get('fpmmTrades', []) if res else []
            all_trades.extend(trades)
            if len(trades) < 1000:
                break
            skip += 1000
            time.sleep(0.25)
        time.sleep(0.3)

    log.info(f'  Fetched {len(all_trades)} trades from {len(market_ids)} markets')
    return all_trades

# ─────────────────────────────────────────────────────────────
#  Step 3: Score wallets
# ─────────────────────────────────────────────────────────────
def score_wallets(
    trades: list[dict],
    market_resolution: dict,   # {fpmm_id → yes_won bool}
    min_trades: int,
    min_winrate: float,
) -> list[dict]:
    """
    Build per-wallet statistics and return ranked wallet list.

    For each trade:
      outcome_index=0 → bought YES tokens
      outcome_index=1 → bought NO tokens
      type=BUY  → opening position
      type=SELL → closing / partial exit

    P&L logic (simplified, mirrors what the subgraph exposes):
      - If a wallet bought YES on a market that resolved YES:
          profit = tokens_received * 1.00 - cost_usdc
      - If a wallet bought YES on a market that resolved NO:
          loss = -cost_usdc
      - SELL trades: treated as early exit, credited collateral received
    """
    # wallet_id → stats dict
    wallets: dict[str, dict] = defaultdict(lambda: {
        'wins':         0,
        'losses':       0,
        'total_trades': 0,
        'net_pnl':      0.0,
        'markets':      set(),
        'buy_volume':   0.0,
    })

    for t in trades:
        addr  = (t.get('creator') or {}).get('id', '').lower()
        fpmm  = (t.get('fpmm') or {}).get('id', '').lower()
        ttype = (t.get('type') or '').upper()
        idx   = int(t.get('outcomeIndex') or 0)
        cost  = int(t.get('collateralAmount') or 0) / 1e6
        tokens = int(t.get('outcomeTokensTraded') or 0) / 1e6

        if not addr or not fpmm or fpmm not in market_resolution:
            continue

        yes_won = market_resolution[fpmm]
        w = wallets[addr]
        w['markets'].add(fpmm)

        if ttype == 'BUY':
            w['total_trades'] += 1
            w['buy_volume'] += cost

            bought_yes = (idx == 0)
            if bought_yes and yes_won:
                # Won: payout = tokens * $1 - cost
                pnl = round(tokens - cost, 4)
                w['net_pnl'] += pnl
                w['wins'] += 1
            elif not bought_yes and not yes_won:
                # Bought NO, NO won
                pnl = round(tokens - cost, 4)
                w['net_pnl'] += pnl
                w['wins'] += 1
            else:
                # Wrong side — lose cost
                w['net_pnl'] -= cost
                w['losses'] += 1

        elif ttype == 'SELL':
            # Early exit: collateral received credited as partial P&L
            w['net_pnl'] += cost

    # Build ranked list
    result = []
    for addr, s in wallets.items():
        total = s['wins'] + s['losses']
        if total < min_trades:
            continue
        win_rate = s['wins'] / total if total > 0 else 0.0
        if win_rate < min_winrate:
            continue
        if s['net_pnl'] <= 0:
            continue

        # Composite score: weight P&L and win rate equally
        # Also reward consistency (more trades = more reliable signal)
        consistency = min(total / 20.0, 1.0)   # caps at 20 trades = max consistency
        score = (s['net_pnl'] / max(s['buy_volume'], 1.0)) * win_rate * (1 + consistency)

        result.append({
            'address':      addr,
            'win_rate':     round(win_rate, 4),
            'net_pnl':      round(s['net_pnl'], 2),
            'total_trades': total,
            'wins':         s['wins'],
            'losses':       s['losses'],
            'markets_count': len(s['markets']),
            'buy_volume':   round(s['buy_volume'], 2),
            'score':        round(score, 6),
        })

    # Sort by composite score descending
    result.sort(key=lambda x: x['score'], reverse=True)
    return result

# ─────────────────────────────────────────────────────────────
#  Step 4: Scout a single coin
# ─────────────────────────────────────────────────────────────
def scout_coin(coin: str, days: int, top: int, min_trades: int, min_winrate: float) -> list[dict]:
    log.info(f'Scouting {coin}…')

    markets = fetch_resolved_markets(coin, days)
    if not markets:
        log.warning(f'  [{coin}] No resolved markets found — check network / keywords')
        return []

    # Build resolution map: fpmm_id → yes_won
    resolution = {m['fpmm_id'].lower(): m['yes_won'] for m in markets}

    fpmm_ids = list(resolution.keys())
    trades = fetch_trades_for_markets(fpmm_ids)
    if not trades:
        log.warning(f'  [{coin}] No trades found')
        return []

    ranked = score_wallets(trades, resolution, min_trades, min_winrate)
    top_wallets = ranked[:top]

    log.info(
        f'  [{coin}] {len(ranked)} qualified wallets  →  keeping top {len(top_wallets)}'
    )
    if top_wallets:
        best = top_wallets[0]
        log.info(
            f'  [{coin}] #1 wallet: {best["address"][:10]}…  '
            f'win_rate={best["win_rate"]:.0%}  '
            f'net_pnl=+${best["net_pnl"]:.2f}  '
            f'trades={best["total_trades"]}'
        )

    return top_wallets

# ─────────────────────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Scout profitable Polymarket wallets')
    parser.add_argument('--coin',       default='ALL',  help='BTC | ETH | SOL | ALL')
    parser.add_argument('--top',        type=int, default=DEFAULT_TOP,        help='wallets to keep per coin')
    parser.add_argument('--days',       type=int, default=DEFAULT_DAYS,       help='look-back window in days')
    parser.add_argument('--min-trades', type=int, default=DEFAULT_MIN_TRADES, help='min trades per wallet')
    parser.add_argument('--min-winrate', type=float, default=DEFAULT_MIN_WINRATE, help='min win rate (0.0–1.0)')
    args = parser.parse_args()

    coins = ['BTC', 'ETH', 'SOL'] if args.coin.upper() == 'ALL' else [args.coin.upper()]

    os.makedirs('data', exist_ok=True)

    result = {}
    scores = {}

    for coin in coins:
        wallets = scout_coin(
            coin,
            days=args.days,
            top=args.top,
            min_trades=args.min_trades,
            min_winrate=args.min_winrate,
        )
        result[coin] = wallets
        scores[coin] = wallets   # same data, full ranking for leaderboard

    # ── Write crypto_wallets.json (read by copy_trader.py) ────────
    out = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'params': {
            'days':       args.days,
            'top':        args.top,
            'min_trades': args.min_trades,
            'min_winrate': args.min_winrate,
        },
        'coins': {
            coin: {
                'top_wallets': wallets,
                'count':       len(wallets),
            }
            for coin, wallets in result.items()
        },
    }

    with open('data/crypto_wallets.json', 'w') as f:
        json.dump(out, f, indent=2)
    log.info('Wrote data/crypto_wallets.json')

    # ── Write wallet_scores.json (for leaderboard / reporting) ────
    with open('data/wallet_scores.json', 'w') as f:
        json.dump(scores, f, indent=2)
    log.info('Wrote data/wallet_scores.json')

    # ── Summary ───────────────────────────────────────────────────
    print()
    print('═' * 60)
    print(f'  Wallet Scout — {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}')
    print('═' * 60)
    for coin, wallets in result.items():
        if not wallets:
            print(f'  {coin}: no wallets found')
            continue
        avg_wr = sum(w['win_rate'] for w in wallets) / len(wallets)
        total_pnl = sum(w['net_pnl'] for w in wallets)
        print(
            f'  {coin}: {len(wallets)} wallets  |  '
            f'avg win rate {avg_wr:.0%}  |  '
            f'combined P&L ${total_pnl:,.0f}'
        )
    print()
    print('  Next step:')
    print('    MODE=btc python copy_trader.py    # copy BTC wallet signals')
    print('    MODE=eth python copy_trader.py    # copy ETH wallet signals')
    print('    MODE=sol python copy_trader.py    # copy SOL wallet signals')
    print('    python monthly_trial.py --start   # begin 30-day trial')
    print()


if __name__ == '__main__':
    main()
