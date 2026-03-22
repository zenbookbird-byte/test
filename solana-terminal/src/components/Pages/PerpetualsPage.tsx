import { useState, useEffect, useRef, useCallback } from 'react'
import { TrendingUp, TrendingDown, Zap, AlertTriangle, Clock, Wifi, WifiOff } from 'lucide-react'
import clsx from 'clsx'

// ─── Market config ────────────────────────────────────────────────────────────
const MARKETS = [
  { symbol: 'BTC',  binWs: 'btcusdt',      binRest: 'BTCUSDT',       tv: 'BINANCE:BTCUSDT',       baseOi: 42.5, baseFund: 0.0082  },
  { symbol: 'ETH',  binWs: 'ethusdt',      binRest: 'ETHUSDT',        tv: 'BINANCE:ETHUSDT',        baseOi: 18.2, baseFund: -0.0031 },
  { symbol: 'SOL',  binWs: 'solusdt',      binRest: 'SOLUSDT',        tv: 'BINANCE:SOLUSDT',        baseOi:  8.6, baseFund: 0.0124  },
  { symbol: 'WIF',  binWs: 'wifusdt',      binRest: 'WIFUSDT',        tv: 'BINANCE:WIFUSDT',        baseOi:  1.2, baseFund: -0.0240 },
  { symbol: 'BONK', binWs: '1000bonkusdt', binRest: '1000BONKUSDT',   tv: 'BINANCE:1000BONKUSDT',   baseOi:  0.8, baseFund: 0.0512  },
]

// Current approximate prices (March 2026) used only when ALL network calls fail
const FALLBACK_PRICES: Record<string, number> = {
  BTC: 84200, ETH: 2080, SOL: 133, WIF: 0.92, BONK: 0.0000195,
}
const FALLBACK_CHANGE: Record<string, number> = {
  BTC: 1.4, ETH: -0.8, SOL: 3.2, WIF: -5.1, BONK: 8.7,
}

interface Ticker {
  price: number
  prevPrice: number
  change: number
  vol: number
  high: number
  low: number
  funding: number
  oi: number
  nextFundSec: number
  lastUpdate: number
}

type FeedStatus = 'connecting' | 'live' | 'rest' | 'offline'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtPrice(p: number, sym: string) {
  if (!p) return '—'
  if (sym === 'BONK') return `$${p.toExponential(3)}`
  if (p >= 10000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (p >= 100)   return `$${p.toFixed(2)}`
  if (p >= 1)     return `$${p.toFixed(4)}`
  return `$${p.toFixed(8)}`
}
function fmtCountdown(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

// ─── TradingView ──────────────────────────────────────────────────────────────
function TvChart({ tvSymbol, interval }: { tvSymbol: string; interval: string }) {
  const src = `https://s.tradingview.com/widgetembed/?` + new URLSearchParams({
    symbol: tvSymbol, interval, theme: 'dark', style: '1', locale: 'en',
    hide_legend: '0', hide_volume: '0', hideideas: '1', withdateranges: '1',
    saveimage: '0', toolbarbg: '080a0e', bgcolor: '080a0e',
    allow_symbol_change: '0',
  })
  return (
    <iframe key={tvSymbol + interval} src={src}
      className="w-full h-full border-0" allow="fullscreen" title="TradingView" />
  )
}

// ─── Price display with flash ────────────────────────────────────────────────
function PriceFlash({ price, sym, className }: {
  price: number; prevPrice?: number; sym: string; className?: string
}) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prev = useRef(price)
  useEffect(() => {
    if (price === prev.current) return
    setFlash(price > prev.current ? 'up' : 'down')
    prev.current = price
    const t = setTimeout(() => setFlash(null), 500)
    return () => clearTimeout(t)
  }, [price])

  return (
    <span className={clsx(
      'font-mono transition-colors duration-150',
      flash === 'up' ? 'text-green-DEFAULT' : flash === 'down' ? 'text-red-DEFAULT' : '',
      className
    )}>
      {fmtPrice(price, sym)}
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function PerpetualsPage() {
  const [selected, setSelected] = useState('SOL')
  const [side, setSide]         = useState<'long' | 'short'>('long')
  const [size, setSize]         = useState('')
  const [leverage, setLeverage] = useState(10)
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [limitPrice, setLimitPrice] = useState('')
  const [interval, setInterval_] = useState('5')
  const [tickers, setTickers]   = useState<Record<string, Ticker>>({})
  const [status, setStatus]     = useState<FeedStatus>('connecting')

  const wsRef   = useRef<WebSocket | null>(null)
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Init tickers from fallback so UI never shows "—" ────────────────────
  useEffect(() => {
    const init: Record<string, Ticker> = {}
    MARKETS.forEach(m => {
      init[m.symbol] = {
        price: FALLBACK_PRICES[m.symbol], prevPrice: FALLBACK_PRICES[m.symbol],
        change: FALLBACK_CHANGE[m.symbol], vol: m.baseOi * 28,
        high: FALLBACK_PRICES[m.symbol] * 1.03, low: FALLBACK_PRICES[m.symbol] * 0.97,
        funding: m.baseFund, oi: m.baseOi,
        nextFundSec: 14400 + Math.floor(Math.random() * 14400),
        lastUpdate: 0,
      }
    })
    setTickers(init)
  }, [])

  // ── Countdown every second ───────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setTickers(prev => {
        const next = { ...prev }
        MARKETS.forEach(m => {
          if (next[m.symbol]) {
            next[m.symbol] = { ...next[m.symbol],
              nextFundSec: next[m.symbol].nextFundSec > 0 ? next[m.symbol].nextFundSec - 1 : 28800 }
          }
        })
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Parse 24hr REST response ─────────────────────────────────────────────
  const applyRestData = useCallback((data: {symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string}[]) => {
    setTickers(prev => {
      const next = { ...prev }
      data.forEach(d => {
        const mkt = MARKETS.find(m => m.binRest === d.symbol)
        if (!mkt) return
        const raw   = parseFloat(d.lastPrice)
        const isBonk = mkt.symbol === 'BONK'
        const price = isBonk ? raw / 1000 : raw
        const high  = isBonk ? parseFloat(d.highPrice) / 1000 : parseFloat(d.highPrice)
        const low   = isBonk ? parseFloat(d.lowPrice) / 1000 : parseFloat(d.lowPrice)
        const old   = prev[mkt.symbol]
        next[mkt.symbol] = {
          price, prevPrice: old?.price ?? price,
          change: parseFloat(d.priceChangePercent),
          vol: parseFloat(d.quoteVolume) / 1e6,
          high, low,
          funding: old?.funding ?? mkt.baseFund,
          oi:      old?.oi      ?? mkt.baseOi,
          nextFundSec: old?.nextFundSec ?? 14400,
          lastUpdate: Date.now(),
        }
      })
      return next
    })
  }, [])

  // ── WebSocket (instant push, ~100ms latency) ─────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current) wsRef.current.close()
    const streams = MARKETS.map(m => `${m.binWs}@ticker`).join('/')
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    wsRef.current = ws

    ws.onopen  = () => setStatus('live')
    ws.onerror = () => setStatus('rest')
    ws.onclose = (e) => { if (e.code !== 1000) setStatus('rest') }

    ws.onmessage = (event) => {
      try {
        const { data: d } = JSON.parse(event.data) as {
          data: { s: string; c: string; P: string; q: string; h: string; l: string }
        }
        const mkt = MARKETS.find(m => m.binRest === d.s)
        if (!mkt) return
        const isBonk = mkt.symbol === 'BONK'
        const price  = isBonk ? parseFloat(d.c) / 1000 : parseFloat(d.c)
        const high   = isBonk ? parseFloat(d.h) / 1000 : parseFloat(d.h)
        const low    = isBonk ? parseFloat(d.l) / 1000 : parseFloat(d.l)
        setTickers(prev => {
          const old = prev[mkt.symbol]
          if (!old) return prev
          return {
            ...prev,
            [mkt.symbol]: {
              ...old, prevPrice: old.price, price,
              change: parseFloat(d.P),
              vol: parseFloat(d.q) / 1e6,
              high, low,
              lastUpdate: Date.now(),
            },
          }
        })
      } catch { /* ignore parse errors */ }
    }
    return ws
  }, [])

  // ── REST polling fallback (when WS fails) ─────────────────────────────────
  const startRestPoll = useCallback(() => {
    if (restRef.current) clearInterval(restRef.current)
    const poll = async () => {
      try {
        const syms = JSON.stringify(MARKETS.map(m => m.binRest))
        const r    = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`)
        if (!r.ok) throw new Error()
        const data = await r.json()
        applyRestData(data)
        setStatus('rest')
      } catch {
        // try CoinGecko as second fallback
        try {
          const r = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogwifhat,bonk&vs_currencies=usd&include_24hr_change=true'
          )
          if (!r.ok) throw new Error()
          const d = await r.json() as Record<string, { usd: number; usd_24h_change: number }>
          const map: Record<string, string> = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', WIF:'dogwifhat', BONK:'bonk' }
          setTickers(prev => {
            const next = { ...prev }
            MARKETS.forEach(m => {
              const cg = d[map[m.symbol]]
              if (!cg) return
              const old = prev[m.symbol]
              next[m.symbol] = {
                ...old, prevPrice: old?.price ?? cg.usd, price: cg.usd,
                change: cg.usd_24h_change ?? 0, lastUpdate: Date.now(),
              }
            })
            return next
          })
          setStatus('rest')
        } catch {
          setStatus('offline')
        }
      }
    }
    poll()
    restRef.current = setInterval(poll, 3000)
  }, [applyRestData])

  // ── Connect on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    const ws = connectWs()
    // If WS doesn't open within 4s, fall back to REST
    const timer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close()
        startRestPoll()
      }
    }, 4000)

    ws.onopen = () => {
      clearTimeout(timer)
      setStatus('live')
      // Also do one REST call immediately to populate vol/high/low
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(MARKETS.map(m => m.binRest)))}`)
        .then(r => r.json()).then(applyRestData).catch(() => {})
    }
    ws.onerror = () => { clearTimeout(timer); startRestPoll() }
    ws.onclose = (e) => { if (e.code !== 1000) { clearTimeout(timer); startRestPoll() } }

    return () => {
      clearTimeout(timer)
      ws.close()
      if (restRef.current) clearInterval(restRef.current)
    }
  }, [connectWs, startRestPoll, applyRestData])

  const mkt    = MARKETS.find(m => m.symbol === selected) ?? MARKETS[2]
  const ticker = tickers[selected]
  const notional  = (parseFloat(size) || 0) * leverage * (ticker?.price ?? 0)
  const liqPrice  = ticker ? ticker.price * (side === 'long' ? 1 - 1 / leverage : 1 + 1 / leverage) : 0
  const isLive    = Date.now() - (ticker?.lastUpdate ?? 0) < 5000

  const INTERVALS = [
    { id: '1', l: '1m' }, { id: '5', l: '5m' }, { id: '15', l: '15m' },
    { id: '60', l: '1h' }, { id: '240', l: '4h' }, { id: 'D', l: '1D' },
  ]

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Market list ───────────────────────────────────────────────────── */}
      <div className="w-52 shrink-0 border-r border-ax-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-ax-border shrink-0">
          <span className="text-xs font-semibold text-text-secondary">Markets</span>
          <div className="flex items-center gap-1.5">
            {status === 'live'
              ? <><Wifi size={10} className="text-green-DEFAULT" /><span className="text-2xs text-green-DEFAULT font-bold">WS</span></>
              : status === 'rest'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-yellow-DEFAULT animate-pulse" /><span className="text-2xs text-yellow-DEFAULT">REST</span></>
              : status === 'connecting'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-blue-accent animate-pulse" /><span className="text-2xs text-text-muted">…</span></>
              : <><WifiOff size={10} className="text-red-DEFAULT" /><span className="text-2xs text-red-DEFAULT">OFF</span></>
            }
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {MARKETS.map(m => {
            const t = tickers[m.symbol]
            const live = t && Date.now() - t.lastUpdate < 5000
            return (
              <button key={m.symbol} onClick={() => setSelected(m.symbol)}
                className={clsx('flex items-center justify-between px-3 py-2.5 text-left w-full transition-colors border-b border-ax-border/50 hover:bg-ax-hover',
                  selected === m.symbol && 'bg-ax-active border-l-2 border-l-green-DEFAULT')}>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-text-primary">{m.symbol}-PERP</span>
                    {live && <span className="w-1 h-1 rounded-full bg-green-DEFAULT" />}
                  </div>
                  <div className="text-2xs text-text-muted">${(t?.oi ?? m.baseOi).toFixed(1)}M OI</div>
                </div>
                <div className="text-right">
                  {t
                    ? <PriceFlash price={t.price} prevPrice={t.prevPrice} sym={m.symbol} className="text-xs" />
                    : <span className="text-xs font-mono text-text-muted">…</span>
                  }
                  <div className={clsx('text-2xs font-mono', (t?.change ?? 0) >= 0 ? 'pos' : 'neg')}>
                    {t ? `${t.change >= 0 ? '+' : ''}${t.change.toFixed(2)}%` : '—'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Chart area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Ticker bar */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-ax-border shrink-0 bg-ax-sidebar overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-bold text-text-primary">{mkt.symbol}-PERP</span>
            {ticker
              ? <PriceFlash price={ticker.price} prevPrice={ticker.prevPrice} sym={mkt.symbol}
                  className="text-xl font-black" />
              : <span className="text-xl font-mono text-text-muted">…</span>
            }
            {ticker && (
              <span className={clsx('badge font-mono', ticker.change >= 0 ? 'badge-green' : 'badge-red')}>
                {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}%
              </span>
            )}
            {isLive && <span className="w-1.5 h-1.5 rounded-full bg-green-DEFAULT animate-pulse" />}
          </div>

          {ticker && (
            <div className="flex items-center gap-4 text-2xs text-text-muted shrink-0">
              <span>H <span className="text-text-primary font-mono">{fmtPrice(ticker.high, mkt.symbol)}</span></span>
              <span>L <span className="text-text-primary font-mono">{fmtPrice(ticker.low, mkt.symbol)}</span></span>
              <span>Vol <span className="text-text-primary font-mono">${ticker.vol.toFixed(0)}M</span></span>
              <span>OI <span className="text-text-primary font-mono">${ticker.oi.toFixed(1)}M</span></span>
              <span>Fund <span className={clsx('font-mono', ticker.funding >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                {ticker.funding >= 0 ? '+' : ''}{(ticker.funding * 100).toFixed(4)}%/hr
              </span></span>
              <span className="flex items-center gap-1">
                <Clock size={9} />
                <span className="font-mono text-text-primary">{fmtCountdown(ticker.nextFundSec)}</span>
              </span>
            </div>
          )}

          {/* Interval pills */}
          <div className="ml-auto flex items-center gap-0 bg-ax-card border border-ax-border rounded-lg overflow-hidden shrink-0">
            {INTERVALS.map(iv => (
              <button key={iv.id} onClick={() => setInterval_(iv.id)}
                className={clsx('px-2 py-1 text-2xs font-semibold transition-colors',
                  interval === iv.id ? 'bg-green-DEFAULT text-ax-base' : 'text-text-muted hover:text-text-primary')}>
                {iv.l}
              </button>
            ))}
          </div>
        </div>

        {/* TradingView chart */}
        <div className="flex-1 overflow-hidden">
          <TvChart tvSymbol={mkt.tv} interval={interval} />
        </div>
      </div>

      {/* ── Order panel ───────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-l border-ax-border flex flex-col overflow-y-auto bg-ax-sidebar">
        <div className="px-3 pt-3 pb-2 border-b border-ax-border">
          <div className="text-xs font-bold text-text-primary">{mkt.symbol}-PERP</div>
          {ticker && (
            <PriceFlash price={ticker.price} prevPrice={ticker.prevPrice} sym={mkt.symbol}
              className="text-2xl font-black block mt-0.5" />
          )}
          {ticker && (
            <div className={clsx('text-xs font-mono', ticker.change >= 0 ? 'pos' : 'neg')}>
              {ticker.change >= 0 ? <TrendingUp size={10} className="inline mr-1"/> : <TrendingDown size={10} className="inline mr-1"/>}
              {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}% (24h)
            </div>
          )}
        </div>

        <div className="p-3 flex flex-col gap-3">
          {/* Order type */}
          <div className="flex bg-ax-card border border-ax-border rounded-lg p-0.5 gap-0.5">
            {(['market','limit'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                className={clsx('flex-1 py-1.5 text-2xs font-semibold rounded-md capitalize transition-colors',
                  orderType === t ? 'bg-ax-panel text-text-primary' : 'text-text-muted hover:text-text-primary')}>
                {t}
              </button>
            ))}
          </div>

          {/* Long / Short */}
          <div className="flex rounded-xl overflow-hidden border border-ax-border">
            <button onClick={() => setSide('long')}
              className={clsx('flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1',
                side === 'long' ? 'bg-green-DEFAULT text-ax-base' : 'text-text-muted hover:text-green-DEFAULT/80')}>
              <TrendingUp size={11} /> LONG
            </button>
            <button onClick={() => setSide('short')}
              className={clsx('flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1',
                side === 'short' ? 'bg-red-DEFAULT text-white' : 'text-text-muted hover:text-red-DEFAULT/80')}>
              <TrendingDown size={11} /> SHORT
            </button>
          </div>

          {/* Leverage */}
          <div>
            <div className="flex justify-between items-center text-2xs text-text-muted mb-2">
              <span>Leverage</span>
              <div className="flex gap-1">
                {[5,10,20,50].map(l => (
                  <button key={l} onClick={() => setLeverage(l)}
                    className={clsx('px-1.5 py-0.5 rounded font-mono text-2xs transition-colors',
                      leverage === l ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-border hover:bg-ax-hover text-text-muted')}>
                    {l}x
                  </button>
                ))}
              </div>
            </div>
            <input type="range" min={1} max={50} value={leverage} onChange={e => setLeverage(+e.target.value)}
              className="w-full h-1.5 accent-green-DEFAULT cursor-pointer" />
            <div className="flex justify-between text-2xs text-text-muted mt-1">
              <span>1x</span><span className="font-mono font-bold text-text-primary">{leverage}x</span><span>50x</span>
            </div>
          </div>

          {/* Limit price */}
          {orderType === 'limit' && (
            <div className="ax-input p-2.5 rounded-lg">
              <div className="text-2xs text-text-muted mb-1">Limit Price</div>
              <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                placeholder={ticker ? fmtPrice(ticker.price, mkt.symbol).replace('$','') : '0.00'}
                className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
            </div>
          )}

          {/* Size */}
          <div className="ax-input p-2.5 rounded-lg">
            <div className="text-2xs text-text-muted mb-1">Size (USD)</div>
            <input type="number" value={size} onChange={e => setSize(e.target.value)} placeholder="0.00"
              className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
            <div className="flex gap-1 mt-2">
              {[25,50,75,100].map(p => (
                <button key={p}
                  className="flex-1 text-2xs py-0.5 bg-ax-border rounded hover:bg-ax-hover text-text-muted hover:text-text-primary transition-colors">
                  {p}%
                </button>
              ))}
            </div>
          </div>

          {/* Order summary */}
          {ticker && (
            <div className="bg-ax-card border border-ax-border rounded-xl p-2.5 space-y-1.5 text-2xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Entry</span>
                <PriceFlash price={ticker.price} prevPrice={ticker.prevPrice} sym={mkt.symbol} className="text-2xs" />
              </div>
              {size && <>
                <div className="flex justify-between">
                  <span className="text-text-muted">Notional</span>
                  <span className="font-mono text-text-primary">${notional.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Liq. Price</span>
                  <span className={clsx('font-mono', side === 'long' ? 'neg' : 'pos')}>{fmtPrice(liqPrice, mkt.symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Fee (0.01%)</span>
                  <span className="font-mono text-text-primary">${(notional * 0.0001).toFixed(3)}</span>
                </div>
              </>}
              <div className="flex justify-between border-t border-ax-border/50 pt-1">
                <span className="text-text-muted">Funding/hr</span>
                <span className={clsx('font-mono',
                  (ticker.funding >= 0 && side === 'long') || (ticker.funding < 0 && side === 'short') ? 'neg' : 'pos')}>
                  {(ticker.funding >= 0 && side === 'long') ? '−' : '+'}{Math.abs(ticker.funding * 100).toFixed(4)}%
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-yellow-DEFAULT/10 border border-yellow-DEFAULT/20 rounded-lg p-2.5 text-2xs text-yellow-DEFAULT">
            <AlertTriangle size={11} className="shrink-0" />
            <span>Up to 50x leverage. Always use stop-loss.</span>
          </div>

          <button className={clsx('w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
            side === 'long' ? 'btn-buy' : 'btn-sell')}>
            <Zap size={12} />
            {side === 'long' ? '↑ Long' : '↓ Short'} {mkt.symbol}
            <span className="opacity-70">({leverage}x)</span>
          </button>
        </div>
      </div>
    </div>
  )
}
