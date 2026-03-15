#!/usr/bin/env python3
"""
Polymarket Copy Trader
======================
Watches the top multi-period wallets tracked by your dashboard and mirrors
their trades on Polymarket in real time.

HOW IT WORKS
------------
1. Reads top wallets from data/war_data.json (or data/crypto_data.json).
2. Every POLL_INTERVAL seconds polls the Polymarket subgraph for new trades
   by those wallets on the tracked markets.
3. When MIN_COPY_WALLETS or more tracked wallets open a BUY on the same
   market, it executes a proportional GTC limit order on your behalf.
4. When MIN_COPY_WALLETS or more tracked wallets SELL / exit, it mirrors
   the exit.
5. Position sizes use 25% fractional Kelly based on the copy-success rate.

SETUP
-----
  pip install py-clob-client requests python-dotenv

Copy .env.example to .env and fill in your credentials:
  POLYMARKET_PRIVATE_KEY=0x...
  COPY_BUDGET_USDC=50
  PAPER_TRADE=true          # set to false when you want real orders

Run:
  python copy_trader.py
"""

import os, json, time, logging, sys, math, requests
from datetime import datetime, timezone
from collections import defaultdict

# Optional Telegram notifier — silently disabled if not configured
try:
    import notifier as _tg
    _TG = True
except ImportError:
    _TG = False

# ─────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('copy_trader.log', mode='a'),
    ]
)
log = logging.getLogger('copy_trader')

# ─────────────────────────────────────────────────────────────
#  .env loader
# ─────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass   # python-dotenv is optional

# ─────────────────────────────────────────────────────────────
#  Config  (all overridable via environment variables)
# ─────────────────────────────────────────────────────────────
CLOB_HOST     = 'https://clob.polymarket.com'
GAMMA_HOST    = 'https://gamma-api.polymarket.com'
SUBGRAPH      = 'https://api.thegraph.com/subgraphs/name/polymarket/matic-markets-5'

PRIVATE_KEY   = os.getenv('POLYMARKET_PRIVATE_KEY', '')
PAPER_TRADE   = os.getenv('PAPER_TRADE', 'true').lower() != 'false'
MODE          = os.getenv('MODE', 'war')          # 'war' | 'btc' | 'eth' | 'sol'
BUDGET_USDC   = float(os.getenv('COPY_BUDGET_USDC', '50'))   # total budget
MAX_POSITION  = float(os.getenv('MAX_POSITION_USDC', '20'))  # cap per market
MIN_WALLETS   = int(os.getenv('MIN_COPY_WALLETS', '2'))       # min agreeing wallets
POLL_SECS     = int(os.getenv('POLL_INTERVAL', '15'))         # seconds between polls
MAX_PRICE     = float(os.getenv('MAX_YES_PRICE', '0.90'))     # skip if YES > 90 ¢
MIN_PRICE     = float(os.getenv('MIN_YES_PRICE', '0.03'))     # skip if YES < 3 ¢
SUCCESS_RATE  = float(os.getenv('SUCCESS_RATE', '0.82'))      # assumed win-rate for Kelly
SLIPPAGE      = float(os.getenv('SLIPPAGE', '0.02'))          # max acceptable slippage

DATA_FILE = {
    'war': 'data/war_data.json',
    'btc': 'data/crypto_data.json',
    'eth': 'data/crypto_data.json',
    'sol': 'data/crypto_data.json',
}.get(MODE, 'data/war_data.json')

CHAIN_ID = 137   # Polygon mainnet

# ─────────────────────────────────────────────────────────────
#  CLOB client (optional — required for live trading)
# ─────────────────────────────────────────────────────────────
_clob = None

def init_clob():
    global _clob
    if PAPER_TRADE:
        log.info('PAPER TRADE MODE — no real orders will be placed')
        return
    if not PRIVATE_KEY:
        log.error('Set POLYMARKET_PRIVATE_KEY in your .env to enable live trading')
        sys.exit(1)
    try:
        from py_clob_client.client import ClobClient
        from py_clob_client.clob_types import ApiCreds, BalanceAllowanceParams, AssetType
    except ImportError:
        log.error('py-clob-client not installed: run  pip install py-clob-client')
        sys.exit(1)

    try:
        # Step 1: derive API key from wallet (idempotent — same key each time)
        tmp = ClobClient(CLOB_HOST, key=PRIVATE_KEY, chain_id=CHAIN_ID)
        creds = tmp.create_api_key()

        # Step 2: full authenticated client
        _clob = ClobClient(
            CLOB_HOST, key=PRIVATE_KEY, chain_id=CHAIN_ID,
            creds=ApiCreds(
                api_key=creds.api_key,
                api_secret=creds.api_secret,
                api_passphrase=creds.api_passphrase,
            )
        )

        # Show balance
        bal = _clob.get_balance_allowance(
            BalanceAllowanceParams(asset_type=AssetType.COLLATERAL)
        )
        log.info(f'CLOB client ready  |  USDC balance: {bal}')
    except Exception as e:
        log.error(f'CLOB init failed: {e}')
        sys.exit(1)

# ─────────────────────────────────────────────────────────────
#  HTTP helpers
# ─────────────────────────────────────────────────────────────
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'polymarket-copy-trader/1.0'})

def http_get(url, **params):
    try:
        r = SESSION.get(url, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.debug(f'GET {url} failed: {e}')
        return None

def http_gql(query, variables=None):
    try:
        r = SESSION.post(SUBGRAPH, json={'query': query, 'variables': variables or {}}, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.debug(f'GQL failed: {e}')
        return None

# ─────────────────────────────────────────────────────────────
#  Load tracked wallets from local data files
# ─────────────────────────────────────────────────────────────
def load_tracked_wallets():
    """Return list of dicts: {address, win_rate, net_pnl, period_score}"""
    try:
        with open(DATA_FILE) as f:
            data = json.load(f)
    except FileNotFoundError:
        log.warning(f'{DATA_FILE} not found — run generate_data.py first')
        return []

    if MODE == 'war':
        rows = data.get('mp_wallets') or data.get('wallet_rows') or []
        return [
            {
                'address':      r.get('address', '').lower(),
                'win_rate':     r.get('win_rate', 0),
                'net_pnl':      r.get('net_pnl', 0),
                'period_score': r.get('period_score', 0),
            }
            for r in rows
            if r.get('address') and r.get('net_pnl', 0) > 0
        ]
    else:
        # Crypto mode — use wallets from the relevant coin
        coin = MODE.upper()
        coin_data = data.get('coins', {}).get(coin, {})
        rows = coin_data.get('mp_wallets') or coin_data.get('top50') or []
        return [
            {
                'address':      r.get('address', '').lower(),
                'win_rate':     r.get('win_rate', 0),
                'net_pnl':      r.get('net_pnl', 0),
                'period_score': r.get('period_score', 0),
            }
            for r in rows
            if r.get('address') and r.get('net_pnl', 0) > 0
        ]

# ─────────────────────────────────────────────────────────────
#  Load open markets
# ─────────────────────────────────────────────────────────────
def load_tracked_markets():
    """Return {market_id → {title, yes_price, slug}}"""
    try:
        with open(DATA_FILE) as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}

    if MODE == 'war':
        mkts = data.get('markets', [])
    else:
        coin = MODE.upper()
        mkts = data.get('coins', {}).get(coin, {}).get('markets', [])

    result = {}
    for m in mkts:
        if m.get('closed'):
            continue
        mid = m.get('id') or m.get('conditionId')
        if mid:
            result[mid] = {
                'title':     m.get('title', ''),
                'yes_price': m.get('yes_price'),
                'slug':      m.get('slug', ''),
            }
    return result

# ─────────────────────────────────────────────────────────────
#  Poll subgraph for recent trades by tracked wallets
# ─────────────────────────────────────────────────────────────
GQL_RECENT = """
query Recent($wallets:[String!]!, $since:Int!, $conds:[String!]!) {
  fpmmTrades(
    first: 500
    where: { creator_in: $wallets, fpmm_in: $conds, creationTimestamp_gt: $since }
    orderBy: creationTimestamp
    orderDirection: desc
  ) {
    id
    type
    creator { id }
    fpmm { id }
    outcomeTokensTraded
    collateralAmount
    creationTimestamp
  }
}
"""

def poll_trades(wallets, market_ids, since_ts):
    """Return list of new trade dicts since since_ts."""
    w_addrs = [w['address'] for w in wallets]
    if not w_addrs or not market_ids:
        return []

    res = http_gql(GQL_RECENT, {
        'wallets': w_addrs,
        'conds':   list(market_ids),
        'since':   since_ts,
    })
    return res.get('data', {}).get('fpmmTrades', []) if res else []

# ─────────────────────────────────────────────────────────────
#  Live price from CLOB orderbook
# ─────────────────────────────────────────────────────────────
def get_live_price(market_id):
    """Return best YES ask price, or None."""
    # Get token IDs from gamma API
    mkts = http_get(f'{GAMMA_HOST}/markets', conditionId=market_id, limit=1)
    if not mkts:
        return None
    mkt = mkts[0] if isinstance(mkts, list) else mkts
    tokens = mkt.get('tokens') or mkt.get('clobTokenIds') or []
    if not tokens:
        prices = mkt.get('outcomePrices', [])
        return float(prices[0]) if prices else None

    yes_token = tokens[0]
    token_id = yes_token.get('token_id') or yes_token.get('tokenId') or yes_token
    if not token_id:
        return None

    book = http_get(f'{CLOB_HOST}/book', token_id=token_id)
    if not book:
        return None
    asks = book.get('asks', [])
    bids = book.get('bids', [])
    if asks:
        return float(asks[0]['price'])
    if bids:
        return float(bids[0]['price'])
    return None

# ─────────────────────────────────────────────────────────────
#  Kelly position sizing
# ─────────────────────────────────────────────────────────────
def kelly_size(price, success_rate=SUCCESS_RATE, fraction=0.25):
    """Return USDC allocation for a YES bet at given price."""
    if price <= 0 or price >= 1:
        return 0.0
    b = (1.0 / price) - 1.0          # net odds on win
    q = 1.0 - success_rate
    k = (b * success_rate - q) / b   # full Kelly fraction
    k = max(0.0, k) * fraction        # fractional Kelly
    return round(min(BUDGET_USDC * k, MAX_POSITION), 2)

# ─────────────────────────────────────────────────────────────
#  Order execution
# ─────────────────────────────────────────────────────────────
def get_yes_token_id(market_id):
    """Fetch the YES outcome token ID for a market."""
    mkts = http_get(f'{GAMMA_HOST}/markets', conditionId=market_id, limit=1)
    if not mkts:
        return None
    mkt = mkts[0] if isinstance(mkts, list) else mkts
    tokens = mkt.get('tokens') or []
    if tokens:
        t = tokens[0]
        return t.get('token_id') or t.get('tokenId')
    return None

def place_buy(market_id, market_title, price, usdc_amount):
    """Buy YES tokens. Returns True on success."""
    shares = round(usdc_amount / price, 2)
    if PAPER_TRADE:
        log.info(
            f'[PAPER] BUY  {shares:.1f} YES tokens @ ${price:.3f}'
            f'  (${usdc_amount:.2f})  ──  {market_title[:60]}'
        )
        return True

    try:
        from py_clob_client.clob_types import OrderArgs, OrderType
    except ImportError:
        log.error('py-clob-client missing')
        return False

    token_id = get_yes_token_id(market_id)
    if not token_id:
        log.warning(f'Cannot find token_id for {market_id}')
        return False

    try:
        args = OrderArgs(token_id=token_id, price=price, size=shares)
        signed = _clob.create_order(args)
        resp = _clob.post_order(signed, OrderType.GTC)
        log.info(
            f'[LIVE] BUY   {shares:.1f} YES @ ${price:.3f}'
            f'  (${usdc_amount:.2f})  |  order={resp}  ──  {market_title[:50]}'
        )
        return True
    except Exception as e:
        log.error(f'BUY failed for {market_id}: {e}')
        return False

def place_sell(market_id, market_title, price, tokens):
    """Sell YES tokens. Returns True on success."""
    if PAPER_TRADE:
        log.info(
            f'[PAPER] SELL {tokens:.1f} YES tokens @ ${price:.3f}'
            f'  (${tokens*price:.2f})  ──  {market_title[:60]}'
        )
        return True

    try:
        from py_clob_client.clob_types import OrderArgs, OrderType, Side
    except ImportError:
        return False

    token_id = get_yes_token_id(market_id)
    if not token_id:
        return False

    try:
        args = OrderArgs(token_id=token_id, price=price, size=tokens, side=Side.SELL)
        signed = _clob.create_order(args)
        resp = _clob.post_order(signed, OrderType.GTC)
        log.info(
            f'[LIVE] SELL  {tokens:.1f} YES @ ${price:.3f}'
            f'  ──  {market_title[:50]}  |  order={resp}'
        )
        return True
    except Exception as e:
        log.error(f'SELL failed for {market_id}: {e}')
        return False

# ─────────────────────────────────────────────────────────────
#  Copy-trade engine
# ─────────────────────────────────────────────────────────────
class CopyTrader:
    def __init__(self):
        self.tracked_wallets   = []       # [{address, win_rate, …}]
        self.tracked_markets   = {}       # {market_id → {title, yes_price, slug}}
        self.wallet_set        = set()    # fast lookup
        self.seen_trade_ids    = set()    # already-processed subgraph IDs
        self.last_poll_ts      = int(time.time()) - POLL_SECS
        self.our_positions     = {}       # {market_id → {tokens, cost, price}}
        # Per-market buy votes: {market_id → set(wallet_addrs that bought)}
        self.buy_votes         = defaultdict(set)
        # Per-market sell votes
        self.sell_votes        = defaultdict(set)

    def reload_config(self):
        """Re-read data files to pick up updated wallets / markets."""
        self.tracked_wallets = load_tracked_wallets()
        self.wallet_set      = {w['address'] for w in self.tracked_wallets}
        self.tracked_markets = load_tracked_markets()
        log.info(
            f'Config: {len(self.tracked_wallets)} wallets  |  '
            f'{len(self.tracked_markets)} open markets  |  '
            f'budget ${BUDGET_USDC}  |  min {MIN_WALLETS} wallets'
        )
        if not self.tracked_wallets:
            log.warning(
                'No tracked wallets found. '
                'Run generate_data.py first or check your data files.'
            )

    def process_trades(self, trades):
        """Tally votes; fire orders when threshold reached."""
        for t in trades:
            tid = t.get('id', '')
            if tid in self.seen_trade_ids:
                continue
            self.seen_trade_ids.add(tid)

            addr    = (t.get('creator') or {}).get('id', '').lower()
            mid     = (t.get('fpmm') or {}).get('id', '')
            ttype   = (t.get('type') or '').upper()
            col     = int(t.get('collateralAmount') or 0) / 1e6
            tokens  = int(t.get('outcomeTokensTraded') or 0) / 1e6
            ts      = int(t.get('creationTimestamp') or 0)
            minfo   = self.tracked_markets.get(mid, {})
            title   = minfo.get('title', mid[:20])

            if addr not in self.wallet_set or mid not in self.tracked_markets:
                continue

            dt = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%H:%M:%S')
            log.info(
                f'  Tracked wallet {addr[:8]}…  {ttype:<4}  '
                f'{tokens:.0f} tokens  ${col:.2f}  [{dt}]  —  {title[:50]}'
            )

            if ttype == 'BUY':
                self.buy_votes[mid].add(addr)
                self.sell_votes[mid].discard(addr)   # reset any prior sell vote
                self._maybe_copy_buy(mid)
            elif ttype == 'SELL':
                self.sell_votes[mid].add(addr)
                self._maybe_copy_sell(mid)

    def _maybe_copy_buy(self, market_id):
        buyers = self.buy_votes[market_id]
        if len(buyers) < MIN_WALLETS:
            return
        if market_id in self.our_positions:
            return   # already holding

        # Get live price
        price = get_live_price(market_id)
        minfo = self.tracked_markets.get(market_id, {})
        title = minfo.get('title', market_id[:30])

        if price is None:
            log.warning(f'Cannot get price for {title[:40]} — skipping')
            return
        if price > MAX_PRICE:
            log.info(f'Skip BUY: price {price:.2f} > MAX_PRICE {MAX_PRICE}  ──  {title[:40]}')
            return
        if price < MIN_PRICE:
            log.info(f'Skip BUY: price {price:.2f} < MIN_PRICE {MIN_PRICE}  ──  {title[:40]}')
            return

        usdc = kelly_size(price)
        if usdc < 0.50:
            log.info(f'Skip BUY: Kelly size ${usdc:.2f} too small  ──  {title[:40]}')
            return

        log.info(
            f'COPY SIGNAL  BUY  {len(buyers)} wallets agree  '
            f'price={price:.3f}  size=${usdc:.2f}  ──  {title[:50]}'
        )
        if _TG:
            _tg.notify_signal(title, len(buyers), price, usdc)
        ok = place_buy(market_id, title, price, usdc)
        if ok:
            shares = round(usdc / price, 2)
            self.our_positions[market_id] = {
                'tokens': shares,
                'cost':   usdc,
                'price':  price,
                'title':  title,
            }
            if _TG:
                _tg.notify_buy(title, price, usdc, PAPER_TRADE)
                _tg.record_buy(market_id, title, price, usdc, shares)
            # Reset votes after acting
            self.buy_votes[market_id].clear()

    def _maybe_copy_sell(self, market_id):
        sellers = self.sell_votes[market_id]
        if len(sellers) < MIN_WALLETS:
            return
        if market_id not in self.our_positions:
            return   # nothing to sell

        pos   = self.our_positions[market_id]
        price = get_live_price(market_id) or pos['price']
        title = pos['title']

        log.info(
            f'EXIT SIGNAL  SELL  {len(sellers)} wallets exiting  '
            f'price={price:.3f}  tokens={pos["tokens"]:.2f}  ──  {title[:50]}'
        )
        ok = place_sell(market_id, title, price, pos['tokens'])
        if ok:
            pnl = round((price - pos['price']) * pos['tokens'], 2)
            log.info(
                f'Position closed  |  cost=${pos["cost"]:.2f}'
                f'  pnl={"+$" if pnl>=0 else "-$"}{abs(pnl):.2f}  ──  {title[:40]}'
            )
            if _TG:
                _tg.notify_sell(title, pos['cost'], pnl, PAPER_TRADE)
                _tg.record_sell(market_id, pnl)
            del self.our_positions[market_id]
            self.sell_votes[market_id].clear()

    def print_positions(self):
        if not self.our_positions:
            return
        log.info('── Open positions ──────────────────────────────────')
        for mid, p in self.our_positions.items():
            cur = get_live_price(mid) or p['price']
            upnl = round((cur - p['price']) * p['tokens'], 2)
            log.info(
                f'  {p["title"][:45]:<45}  '
                f'{p["tokens"]:.2f} tkns @ {p["price"]:.3f}'
                f'  now={cur:.3f}  uPnL={"+$" if upnl>=0 else "-$"}{abs(upnl):.2f}'
            )
        log.info('───────────────────────────────────────────────────')

    def run(self):
        """Main polling loop."""
        log.info('═' * 60)
        log.info(f'  Polymarket Copy Trader  —  mode={MODE.upper()}')
        log.info(f'  {"PAPER TRADE" if PAPER_TRADE else "⚡ LIVE TRADE"}  |  budget=${BUDGET_USDC}  |  poll={POLL_SECS}s')
        log.info('═' * 60)

        self.reload_config()

        cycle = 0
        while True:
            try:
                now = int(time.time())
                cycle += 1

                # Reload config every 10 cycles (~2-3 min) to pick up new wallets/markets
                if cycle % 10 == 0:
                    self.reload_config()

                # Check if paused via Telegram
                if _TG and _tg.is_paused():
                    if cycle % 20 == 0:
                        log.info('Bot is PAUSED via Telegram — skipping signal checks')
                    time.sleep(POLL_SECS)
                    continue

                if self.tracked_wallets and self.tracked_markets:
                    trades = poll_trades(
                        self.tracked_wallets,
                        self.tracked_markets.keys(),
                        self.last_poll_ts,
                    )
                    self.last_poll_ts = now - 5   # small overlap to avoid gaps

                    if trades:
                        log.info(f'Poll: {len(trades)} new trade(s) by tracked wallets')
                        self.process_trades(trades)
                    else:
                        # Quiet tick every ~5 cycles
                        if cycle % 5 == 0:
                            log.info(
                                f'Poll #{cycle}  |  watching {len(self.tracked_wallets)} wallets'
                                f'  on {len(self.tracked_markets)} markets  |  '
                                f'{len(self.our_positions)} position(s) open'
                            )
                else:
                    if cycle == 1:
                        log.warning('No wallets/markets loaded — retrying next cycle')

                # Print open positions every 20 cycles (~5 min)
                if cycle % 20 == 0:
                    self.print_positions()

            except KeyboardInterrupt:
                log.info('Stopped by user')
                self.print_positions()
                break
            except Exception as e:
                log.exception(f'Unexpected error in cycle {cycle}: {e}')

            time.sleep(POLL_SECS)

# ─────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if '--help' in sys.argv or '-h' in sys.argv:
        print(__doc__)
        sys.exit(0)

    init_clob()
    if _TG:
        _tg.init(PAPER_TRADE, MODE, BUDGET_USDC)
        _tg.notify_start(PAPER_TRADE, MODE, BUDGET_USDC)
    bot = CopyTrader()
    bot.run()
