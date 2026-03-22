import { useState, useEffect, useRef, useCallback } from 'react'
import { TrendingUp, TrendingDown, Zap, AlertTriangle, Clock, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

// ─── Market config ────────────────────────────────────────────────────────────
const MARKETS = [
  { symbol: 'BTC',  bin: 'BTCUSDT',  tv: 'BINANCE:BTCUSDT',  baseOi: 42.5, baseFund: 0.01  },
  { symbol: 'ETH',  bin: 'ETHUSDT',  tv: 'BINANCE:ETHUSDT',  baseOi: 18.2, baseFund: -0.02 },
  { symbol: 'SOL',  bin: 'SOLUSDT',  tv: 'BINANCE:SOLUSDT',  baseOi:  8.6, baseFund:  0.04 },
  { symbol: 'WIF',  bin: 'WIFUSDT',  tv: 'BINANCE:WIFUSDT',  baseOi:  1.2, baseFund: -0.08 },
  { symbol: 'BONK', bin: '1000BONKUSDT', tv: 'BINANCE:1000BONKUSDT', baseOi: 0.8, baseFund: 0.12 },
]

interface Ticker {
  symbol: string
  price: number
  change: number     // 24h %
  vol: number        // 24h volume $M
  high: number
  low: number
  funding: number    // simulated %/hr
  oi: number         // simulated $M
  nextFundSec: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtPrice(p: number, sym: string) {
  if (sym === 'BONK') return p < 0.001 ? `$${p.toFixed(8)}` : `$${p.toFixed(6)}`
  if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (p >= 1)    return `$${p.toFixed(4)}`
  return `$${p.toFixed(8)}`
}

function fmtCountdown(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

// Jitter funding/OI so they "live" fluctuate
function jitter(base: number, spread = 0.08) {
  return base * (1 + (Math.random() - 0.5) * spread)
}

// ─── Price flash hook ─────────────────────────────────────────────────────────
function useFlash(value: number) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prev = useRef(value)
  useEffect(() => {
    if (value === prev.current) return
    setFlash(value > prev.current ? 'up' : 'down')
    prev.current = value
    const t = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(t)
  }, [value])
  return flash
}

// ─── TradingView chart ────────────────────────────────────────────────────────
function TvChart({ tvSymbol, interval = '5' }: { tvSymbol: string; interval?: string }) {
  const src = `https://s.tradingview.com/widgetembed/?` + new URLSearchParams({
    symbol: tvSymbol,
    interval,
    theme: 'dark',
    style: '1',
    locale: 'en',
    hide_legend: '0',
    hide_volume: '0',
    hideideas: '1',
    withdateranges: '1',
    saveimage: '0',
    toolbarbg: '0d0f14',
    bgcolor: '0d0f14',
    gridcolor: '1a1d27',
    linecolor: '16c784',
  }).toString()

  return (
    <iframe
      key={tvSymbol + interval}
      src={src}
      className="w-full h-full border-0"
      allow="fullscreen"
      title="TradingView Chart"
    />
  )
}

// ─── Market list row ─────────────────────────────────────────────────────────
function MarketRow({ m, ticker, selected, onClick }: {
  m: typeof MARKETS[0]
  ticker: Ticker | undefined
  selected: boolean
  onClick: () => void
}) {
  const flash = useFlash(ticker?.price ?? 0)

  return (
    <button onClick={onClick}
      className={clsx('flex items-center justify-between px-3 py-2.5 text-left w-full transition-colors border-b border-ax-border/50 hover:bg-ax-hover',
        selected && 'bg-ax-active border-l-2 border-l-green-DEFAULT')}>
      <div>
        <div className="text-xs font-bold text-text-primary">{m.symbol}-PERP</div>
        <div className="text-2xs text-text-muted">${(ticker?.oi ?? m.baseOi).toFixed(1)}M OI</div>
      </div>
      <div className="text-right">
        <div className={clsx('text-xs font-mono transition-colors',
          flash === 'up' ? 'text-green-DEFAULT' : flash === 'down' ? 'text-red-DEFAULT' : 'text-text-primary')}>
          {ticker ? fmtPrice(ticker.price, m.symbol) : '…'}
        </div>
        <div className={clsx('text-2xs font-mono', (ticker?.change ?? 0) >= 0 ? 'pos' : 'neg')}>
          {ticker ? `${ticker.change >= 0 ? '+' : ''}${ticker.change.toFixed(2)}%` : '…'}
        </div>
      </div>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function PerpetualsPage() {
  const [selected, setSelected] = useState('SOL')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [limitPrice, setLimitPrice] = useState('')
  const [interval, setInterval_] = useState('5')
  const [tickers, setTickers] = useState<Record<string, Ticker>>({})
  const [loading, setLoading] = useState(true)
  const [liveOk, setLiveOk] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const market = MARKETS.find(m => m.symbol === selected) ?? MARKETS[2]
  const ticker = tickers[selected]
  const priceFlash = useFlash(ticker?.price ?? 0)

  // ── Fetch prices from Binance REST ────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    try {
      const symbols = JSON.stringify(MARKETS.map(m => m.bin))
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('bad response')
      const data: { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string }[] = await res.json()

      setTickers(prev => {
        const next = { ...prev }
        data.forEach(d => {
          const mkt = MARKETS.find(m => m.bin === d.symbol)
          if (!mkt) return
          const rawPrice = parseFloat(d.lastPrice)
          // BONK on Binance is quoted as 1000BONK, divide by 1000 for real BONK price
          const price = mkt.symbol === 'BONK' ? rawPrice / 1000 : rawPrice
          const prevEntry = prev[mkt.symbol]
          next[mkt.symbol] = {
            symbol: mkt.symbol,
            price,
            change: parseFloat(d.priceChangePercent),
            vol: parseFloat(d.quoteVolume) / 1e6,
            high: mkt.symbol === 'BONK' ? parseFloat(d.highPrice) / 1000 : parseFloat(d.highPrice),
            low: mkt.symbol === 'BONK' ? parseFloat(d.lowPrice) / 1000 : parseFloat(d.lowPrice),
            // Gently drift OI and funding from the previous value
            funding: prevEntry ? prevEntry.funding * 0.98 + jitter(mkt.baseFund, 0.05) * 0.02 : jitter(mkt.baseFund),
            oi: prevEntry ? prevEntry.oi * 0.99 + jitter(mkt.baseOi, 0.03) * 0.01 : jitter(mkt.baseOi),
            nextFundSec: prevEntry?.nextFundSec ?? (Math.floor(Math.random() * 28800)),
          }
        })
        return next
      })
      setLiveOk(true)
      setLoading(false)
    } catch {
      // Fallback to static prices if API fails
      setTickers(prev => {
        if (Object.keys(prev).length > 0) return prev
        const fallback: Record<string, Ticker> = {}
        MARKETS.forEach(m => {
          const staticPrices: Record<string, number> = { BTC: 97420, ETH: 3840, SOL: 185, WIF: 2.34, BONK: 0.000028 }
          fallback[m.symbol] = {
            symbol: m.symbol, price: staticPrices[m.symbol], change: jitter(m.baseFund * 100, 2),
            vol: m.baseOi * 28, high: staticPrices[m.symbol] * 1.03, low: staticPrices[m.symbol] * 0.97,
            funding: m.baseFund, oi: m.baseOi, nextFundSec: 14400,
          }
        })
        return fallback
      })
      setLoading(false)
    }
  }, [])

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setTickers(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(sym => {
          const t = next[sym]
          next[sym] = { ...t, nextFundSec: t.nextFundSec > 0 ? t.nextFundSec - 1 : 28800 }
        })
        return next
      })
    }, 1000)
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  // ── Price poll every 2s ───────────────────────────────────────────────────
  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 2000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const notional = (parseFloat(size) || 0) * leverage * (ticker?.price ?? 0)
  const liqPrice = ticker ? ticker.price * (side === 'long' ? 1 - 1 / leverage : 1 + 1 / leverage) : 0

  const INTERVALS = [
    { id: '1', label: '1m' }, { id: '5', label: '5m' }, { id: '15', label: '15m' },
    { id: '60', label: '1h' }, { id: '240', label: '4h' }, { id: 'D', label: '1D' },
  ]

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Market list ── */}
      <div className="w-52 shrink-0 border-r border-ax-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-ax-border shrink-0">
          <span className="text-xs font-semibold text-text-secondary">Markets</span>
          <div className="flex items-center gap-1">
            {liveOk
              ? <span className="w-1.5 h-1.5 rounded-full bg-green-DEFAULT animate-pulse" />
              : <RefreshCw size={10} className="text-text-muted animate-spin" />
            }
            <span className="text-2xs text-text-muted">{liveOk ? 'LIVE' : 'Loading'}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {MARKETS.map(m => (
            <MarketRow key={m.symbol} m={m} ticker={tickers[m.symbol]}
              selected={selected === m.symbol} onClick={() => setSelected(m.symbol)} />
          ))}
        </div>
      </div>

      {/* ── Chart + toolbar ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Ticker bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-ax-border shrink-0 bg-ax-sidebar flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-bold text-text-primary">{market.symbol}-PERP</span>
            {loading
              ? <span className="text-xl font-mono text-text-muted">…</span>
              : <span className={clsx('text-xl font-bold font-mono transition-colors',
                  priceFlash === 'up' ? 'text-green-DEFAULT' :
                  priceFlash === 'down' ? 'text-red-DEFAULT' : 'text-text-primary')}>
                  {ticker ? fmtPrice(ticker.price, market.symbol) : '—'}
                </span>
            }
            {ticker && (
              <span className={clsx('badge text-xs font-mono', ticker.change >= 0 ? 'badge-green' : 'badge-red')}>
                {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}%
              </span>
            )}
          </div>

          {ticker && (
            <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap">
              <div><span className="text-text-muted">24h High </span><span className="text-text-primary font-mono">{fmtPrice(ticker.high, market.symbol)}</span></div>
              <div><span className="text-text-muted">24h Low </span><span className="text-text-primary font-mono">{fmtPrice(ticker.low, market.symbol)}</span></div>
              <div><span className="text-text-muted">Vol </span><span className="text-text-primary font-mono">${ticker.vol.toFixed(0)}M</span></div>
              <div><span className="text-text-muted">OI </span><span className="text-text-primary font-mono">${ticker.oi.toFixed(1)}M</span></div>
              <div>
                <span className="text-text-muted">Funding </span>
                <span className={clsx('font-mono', ticker.funding >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                  {ticker.funding >= 0 ? '+' : ''}{ticker.funding.toFixed(4)}%/hr
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Clock size={10} className="text-text-muted" />
                <span className="text-text-primary font-mono">{fmtCountdown(ticker.nextFundSec)}</span>
              </div>
            </div>
          )}

          {/* Interval selector */}
          <div className="ml-auto flex items-center gap-0 bg-ax-card border border-ax-border rounded-lg overflow-hidden shrink-0">
            {INTERVALS.map(iv => (
              <button key={iv.id} onClick={() => setInterval_(iv.id)}
                className={clsx('px-2 py-1 text-2xs font-semibold transition-colors',
                  interval === iv.id ? 'bg-green-DEFAULT text-ax-base' : 'text-text-muted hover:text-text-primary')}>
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        {/* TradingView chart */}
        <div className="flex-1 overflow-hidden">
          <TvChart tvSymbol={market.tv} interval={interval} />
        </div>
      </div>

      {/* ── Order panel ── */}
      <div className="w-64 shrink-0 border-l border-ax-border flex flex-col overflow-y-auto bg-ax-sidebar">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-ax-border">
          <div className="text-xs font-bold text-text-primary">{market.symbol}-PERP</div>
          {ticker && (
            <div className={clsx('text-lg font-black font-mono transition-colors',
              priceFlash === 'up' ? 'text-green-DEFAULT' :
              priceFlash === 'down' ? 'text-red-DEFAULT' : 'text-text-primary')}>
              {fmtPrice(ticker.price, market.symbol)}
            </div>
          )}
        </div>

        <div className="p-3 flex flex-col gap-3 flex-1">
          {/* Order type */}
          <div className="flex gap-1 bg-ax-card border border-ax-border rounded-lg p-0.5">
            {(['market', 'limit'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className={clsx('flex-1 py-1.5 text-2xs font-semibold rounded-md transition-colors capitalize',
                  orderType === t ? 'bg-ax-hover text-text-primary' : 'text-text-muted hover:text-text-primary')}>
                {t}
              </button>
            ))}
          </div>

          {/* Long / Short */}
          <div className="flex rounded-lg overflow-hidden border border-ax-border">
            <button onClick={() => setSide('long')}
              className={clsx('flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1',
                side === 'long' ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card text-text-muted hover:text-green-DEFAULT')}>
              <TrendingUp size={11} /> LONG
            </button>
            <button onClick={() => setSide('short')}
              className={clsx('flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1',
                side === 'short' ? 'bg-red-DEFAULT text-white' : 'bg-ax-card text-text-muted hover:text-red-DEFAULT')}>
              <TrendingDown size={11} /> SHORT
            </button>
          </div>

          {/* Leverage */}
          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-2">
              <span>Leverage</span>
              <div className="flex gap-1">
                {[5,10,20,50].map(l => (
                  <button key={l} onClick={() => setLeverage(l)}
                    className={clsx('px-1.5 py-0.5 rounded text-2xs font-mono transition-colors',
                      leverage === l ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-border text-text-muted hover:text-text-primary')}>
                    {l}x
                  </button>
                ))}
              </div>
            </div>
            <input type="range" min={1} max={50} value={leverage}
              onChange={e => setLeverage(+e.target.value)}
              className="w-full h-1.5 accent-green-DEFAULT cursor-pointer" />
            <div className="flex justify-between text-2xs text-text-muted mt-1">
              <span>1x</span><span className="font-mono font-bold text-text-primary">{leverage}x</span><span>50x</span>
            </div>
          </div>

          {/* Limit price */}
          {orderType === 'limit' && (
            <div className="ax-input p-2.5 rounded-lg">
              <div className="text-2xs text-text-muted mb-1">Limit Price (USD)</div>
              <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                placeholder={ticker ? fmtPrice(ticker.price, market.symbol) : '0.00'}
                className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
            </div>
          )}

          {/* Size */}
          <div className="ax-input p-2.5 rounded-lg">
            <div className="text-2xs text-text-muted mb-1">Size (USD)</div>
            <input type="number" value={size} onChange={e => setSize(e.target.value)} placeholder="0.00"
              className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
            <div className="flex gap-1 mt-2">
              {[25, 50, 75, 100].map(pct => (
                <button key={pct}
                  className="flex-1 text-2xs py-0.5 bg-ax-border text-text-muted rounded hover:bg-ax-hover hover:text-text-primary transition-colors">
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Order preview */}
          {(size || ticker) && (
            <div className="bg-ax-card border border-ax-border rounded-xl p-2.5 space-y-1.5 text-2xs animate-fade-in">
              <div className="flex justify-between">
                <span className="text-text-muted">Notional</span>
                <span className="text-text-primary font-mono">${notional.toFixed(0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Leverage</span>
                <span className="text-text-primary font-mono">{leverage}x</span>
              </div>
              {ticker && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Entry Price</span>
                  <span className="text-text-primary font-mono">{fmtPrice(ticker.price, market.symbol)}</span>
                </div>
              )}
              {ticker && size && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Liq. Price</span>
                  <span className={clsx('font-mono', side === 'long' ? 'neg' : 'pos')}>
                    {fmtPrice(liqPrice, market.symbol)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-muted">Fee (0.01%)</span>
                <span className="text-text-primary font-mono">${(notional * 0.0001).toFixed(3)}</span>
              </div>
              {ticker && (
                <div className="flex justify-between border-t border-ax-border/50 pt-1.5">
                  <span className="text-text-muted">Funding/hr</span>
                  <span className={clsx('font-mono', ticker.funding >= 0 ? (side === 'long' ? 'neg' : 'pos') : (side === 'long' ? 'pos' : 'neg'))}>
                    {ticker.funding >= 0 ? (side === 'long' ? '-' : '+') : (side === 'long' ? '+' : '-')}{Math.abs(ticker.funding).toFixed(4)}%
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-ax-card border border-yellow-DEFAULT/20 rounded-lg p-2.5 text-2xs text-yellow-DEFAULT">
            <AlertTriangle size={11} className="shrink-0" />
            <span>Up to 50x leverage. Positions can be liquidated.</span>
          </div>

          <button className={clsx('w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all mt-auto',
            side === 'long' ? 'btn-buy' : 'btn-sell')}>
            <Zap size={12} />
            {side === 'long' ? '↑ Long' : '↓ Short'} {market.symbol}
            {leverage > 1 && <span className="opacity-70">({leverage}x)</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
