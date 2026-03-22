import { useState, useEffect, useRef, useCallback } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

// ─── Markets ─────────────────────────────────────────────────────────────────
const MARKETS = [
  { symbol: 'BTC',  label: 'Bitcoin',  binWs: 'btcusdt',      binRest: 'BTCUSDT',     tv: 'BINANCE:BTCUSDT',     baseOi: 42.5, baseVol: 1240, baseFund: 0.0082  },
  { symbol: 'ETH',  label: 'Ethereum', binWs: 'ethusdt',      binRest: 'ETHUSDT',     tv: 'BINANCE:ETHUSDT',     baseOi: 18.2, baseVol: 420,  baseFund: -0.0031 },
  { symbol: 'SOL',  label: 'Solana',   binWs: 'solusdt',      binRest: 'SOLUSDT',     tv: 'BINANCE:SOLUSDT',     baseOi:  8.6, baseVol: 186,  baseFund: 0.0124  },
  { symbol: 'WIF',  label: 'dogwifhat',binWs: 'wifusdt',      binRest: 'WIFUSDT',     tv: 'BINANCE:WIFUSDT',     baseOi:  1.2, baseVol:  42,  baseFund: -0.0240 },
  { symbol: 'BONK', label: 'Bonk',     binWs: '1000bonkusdt', binRest: '1000BONKUSDT',tv: 'BINANCE:1000BONKUSDT',baseOi:  0.8, baseVol:  18,  baseFund: 0.0512  },
]

const FALLBACK: Record<string, { price: number; change: number }> = {
  BTC: { price: 84200, change: 1.4 }, ETH: { price: 2080, change: -0.8 },
  SOL: { price: 133,   change: 3.2 }, WIF: { price: 0.92, change: -5.1 },
  BONK:{ price: 0.0000195, change: 8.7 },
}

interface Tick {
  price: number; prev: number; change: number
  vol: number; high: number; low: number
  funding: number; oi: number; nextFundSec: number; ts: number
}

type FeedState = 'connecting' | 'live' | 'rest' | 'offline'

// ─── Utils ───────────────────────────────────────────────────────────────────
function fmtP(p: number, sym: string) {
  if (!p) return '—'
  if (sym === 'BONK') return `$${p.toFixed(9).replace(/\.?0+$/, '').replace(/(\.\d{4})\d+/, '$1')}`
  if (p >= 10000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (p >= 100)   return `$${p.toFixed(2)}`
  if (p >= 1)     return `$${p.toFixed(4)}`
  return `$${p.toFixed(8)}`
}
function fmtPSm(p: number, sym: string) {
  if (!p) return '—'
  if (sym === 'BONK') return `$${p.toExponential(3)}`
  if (p >= 10000) return `$${(p / 1000).toFixed(1)}K`
  return fmtP(p, sym)
}
function fmtTimer(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

// ─── TradingView chart ────────────────────────────────────────────────────────
function TvChart({ symbol, interval }: { symbol: string; interval: string }) {
  const mkt = MARKETS.find(m => m.symbol === symbol)!
  const params = new URLSearchParams({
    symbol: mkt.tv, interval, theme: 'dark', style: '1', locale: 'en',
    hide_legend: '0', hide_volume: '1', hideideas: '1', withdateranges: '1',
    saveimage: '0', toolbarbg: '070810', bgcolor: '070810', gridcolor: '0e1120',
    allow_symbol_change: '0', studies: 'Volume@tv-basicstudies',
  })
  return (
    <iframe
      key={symbol + interval}
      src={`https://s.tradingview.com/widgetembed/?${params}`}
      className="w-full h-full border-0"
      allow="fullscreen"
      title="chart"
    />
  )
}

// ─── Price number with flash ──────────────────────────────────────────────────
function Num({ value, sym, className, large }: {
  value: number; sym: string; className?: string; large?: boolean
}) {
  const [cls, setCls] = useState('')
  const prev = useRef(value)
  useEffect(() => {
    if (value === prev.current) return
    setCls(value > prev.current ? 'price-flash-up' : 'price-flash-down')
    prev.current = value
    const t = setTimeout(() => setCls(''), 600)
    return () => clearTimeout(t)
  }, [value])
  return (
    <span className={clsx('font-mono tabular-nums', large ? 'font-bold' : 'font-medium', cls, className)}>
      {large ? fmtP(value, sym) : fmtPSm(value, sym)}
    </span>
  )
}

// ─── Change badge ─────────────────────────────────────────────────────────────
function Chg({ v, className }: { v: number; className?: string }) {
  const pos = v >= 0
  return (
    <span className={clsx('font-mono tabular-nums flex items-center gap-0.5', pos ? 'pos' : 'neg', className)}>
      {pos ? <ChevronUp size={9} strokeWidth={3} /> : <ChevronDown size={9} strokeWidth={3} />}
      {Math.abs(v).toFixed(2)}%
    </span>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function PerpetualsPage() {
  const [selected, setSelected] = useState('SOL')
  const [side, setSide]         = useState<'long' | 'short'>('long')
  const [size, setSize]         = useState('')
  const [leverage, setLeverage] = useState(10)
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'tp/sl'>('market')
  const [limitPx, setLimitPx]   = useState('')
  const [interval, setInterval_]= useState('15')
  const [pct, setPct]           = useState<number | null>(null)
  const [ticks, setTicks]       = useState<Record<string, Tick>>({})
  const [feed, setFeed]         = useState<FeedState>('connecting')

  const wsRef   = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // init from fallback
  useEffect(() => {
    const init: Record<string, Tick> = {}
    MARKETS.forEach(m => {
      const fb = FALLBACK[m.symbol]
      init[m.symbol] = {
        price: fb.price, prev: fb.price, change: fb.change,
        vol: m.baseVol, high: fb.price * 1.032, low: fb.price * 0.968,
        funding: m.baseFund, oi: m.baseOi,
        nextFundSec: 14400 + Math.floor(Math.random() * 14000), ts: 0,
      }
    })
    setTicks(init)
  }, [])

  // countdown
  useEffect(() => {
    const id = setInterval(() => {
      setTicks(prev => {
        const n = { ...prev }
        MARKETS.forEach(m => {
          if (n[m.symbol]) n[m.symbol] = { ...n[m.symbol],
            nextFundSec: n[m.symbol].nextFundSec > 0 ? n[m.symbol].nextFundSec - 1 : 28800 }
        })
        return n
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const applyRest = useCallback((data: { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string }[]) => {
    setTicks(prev => {
      const n = { ...prev }
      data.forEach(d => {
        const m = MARKETS.find(x => x.binRest === d.symbol)
        if (!m) return
        const isBonk = m.symbol === 'BONK'
        const price  = isBonk ? parseFloat(d.lastPrice) / 1000 : parseFloat(d.lastPrice)
        const high   = isBonk ? parseFloat(d.highPrice) / 1000 : parseFloat(d.highPrice)
        const low    = isBonk ? parseFloat(d.lowPrice) / 1000 : parseFloat(d.lowPrice)
        const old    = prev[m.symbol]
        n[m.symbol] = {
          price, prev: old?.price ?? price,
          change: parseFloat(d.priceChangePercent),
          vol: parseFloat(d.quoteVolume) / 1e6,
          high, low,
          funding: old?.funding ?? m.baseFund,
          oi: old?.oi ?? m.baseOi,
          nextFundSec: old?.nextFundSec ?? 14400,
          ts: Date.now(),
        }
      })
      return n
    })
  }, [])

  const connectWs = useCallback(() => {
    if (wsRef.current) wsRef.current.close()
    const streams = MARKETS.map(m => `${m.binWs}@ticker`).join('/')
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    wsRef.current = ws
    ws.onmessage = e => {
      try {
        const { data: d } = JSON.parse(e.data) as { data: { s: string; c: string; P: string; q: string; h: string; l: string } }
        const m = MARKETS.find(x => x.binRest === d.s)
        if (!m) return
        const isBonk = m.symbol === 'BONK'
        const price  = isBonk ? parseFloat(d.c) / 1000 : parseFloat(d.c)
        const high   = isBonk ? parseFloat(d.h) / 1000 : parseFloat(d.h)
        const low    = isBonk ? parseFloat(d.l) / 1000 : parseFloat(d.l)
        setTicks(prev => {
          const old = prev[m.symbol]
          if (!old) return prev
          return { ...prev, [m.symbol]: { ...old, prev: old.price, price, change: parseFloat(d.P), vol: parseFloat(d.q) / 1e6, high, low, ts: Date.now() } }
        })
      } catch { /* skip */ }
    }
    return ws
  }, [])

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    const run = async () => {
      try {
        const syms = encodeURIComponent(JSON.stringify(MARKETS.map(m => m.binRest)))
        const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${syms}`)
        if (!r.ok) throw new Error()
        applyRest(await r.json())
        setFeed('rest')
      } catch {
        try {
          const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogwifhat,bonk&vs_currencies=usd&include_24hr_change=true')
          if (!r.ok) throw new Error()
          const d = await r.json() as Record<string, { usd: number; usd_24h_change: number }>
          const map: Record<string, string> = { BTC:'bitcoin',ETH:'ethereum',SOL:'solana',WIF:'dogwifhat',BONK:'bonk' }
          setTicks(prev => {
            const n = { ...prev }
            MARKETS.forEach(m => {
              const cg = d[map[m.symbol]]
              if (!cg) return
              const old = prev[m.symbol]
              n[m.symbol] = { ...old, prev: old?.price ?? cg.usd, price: cg.usd, change: cg.usd_24h_change ?? 0, ts: Date.now() }
            })
            return n
          })
          setFeed('rest')
        } catch { setFeed('offline') }
      }
    }
    run()
    pollRef.current = setInterval(run, 3000)
  }, [applyRest])

  useEffect(() => {
    const ws = connectWs()
    const timer = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) { ws.close(); startPoll() } }, 4000)
    ws.onopen = () => {
      clearTimeout(timer); setFeed('live')
      const syms = encodeURIComponent(JSON.stringify(MARKETS.map(m => m.binRest)))
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${syms}`).then(r => r.json()).then(applyRest).catch(() => {})
    }
    ws.onerror = () => { clearTimeout(timer); startPoll() }
    ws.onclose = ev => { if (ev.code !== 1000) { clearTimeout(timer); startPoll() } }
    return () => { clearTimeout(timer); ws.close(); if (pollRef.current) clearInterval(pollRef.current) }
  }, [connectWs, startPoll, applyRest])

  const mkt    = MARKETS.find(m => m.symbol === selected)!
  const tick   = ticks[selected]
  const isLive = tick && Date.now() - tick.ts < 5000

  const sizeNum   = parseFloat(size) || 0
  const notional  = sizeNum * leverage * (tick?.price ?? 0)
  const liqPx     = tick ? tick.price * (side === 'long' ? 1 - 1 / leverage : 1 + 1 / leverage) : 0
  const margin    = notional / leverage

  const IVLS = [
    { id: '1', l: '1m' }, { id: '5', l: '5m' }, { id: '15', l: '15m' },
    { id: '60', l: '1H' }, { id: '240', l: '4H' }, { id: 'D', l: '1D' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '178px 1fr 260px', height: '100%', overflow: 'hidden', background: '#070810' }}>

      {/* ═══ LEFT — Market list ════════════════════════════════════════════ */}
      <div style={{ borderRight: '1px solid #111525', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #111525', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#3a4560', textTransform: 'uppercase' }}>Markets</span>
          {/* Feed indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={clsx('feed-dot',
              feed === 'live' ? 'feed-dot-green' : feed === 'rest' ? 'feed-dot-yellow' : 'feed-dot-red')} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              color: feed === 'live' ? '#00d084' : feed === 'rest' ? '#f5b24b' : '#ff3b5c' }}>
              {feed === 'live' ? 'LIVE' : feed === 'rest' ? 'REST' : feed === 'connecting' ? '...' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Col headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '4px 10px 4px', borderBottom: '1px solid #0e1120' }}>
          <span style={{ fontSize: 9, color: '#2e3450', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pair</span>
          <span style={{ fontSize: 9, color: '#2e3450', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right' }}>Price / 24h</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {MARKETS.map(m => {
            const t  = ticks[m.symbol]
            const up = (t?.change ?? 0) >= 0
            return (
              <div key={m.symbol} className={clsx('perp-mkt-row', selected === m.symbol && 'active')}
                onClick={() => setSelected(m.symbol)}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {/* coloured dot */}
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: up ? '#00d084' : '#ff3b5c', flexShrink: 0,
                      boxShadow: `0 0 5px ${up ? '#00d08470' : '#ff3b5c70'}` }} />
                    <span style={{ fontWeight: 700, fontSize: 11, color: '#d8e0f0' }}>{m.symbol}</span>
                    <span style={{ fontSize: 9, color: '#2e3450', fontWeight: 500 }}>PERP</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#2e3450', marginTop: 2, paddingLeft: 11 }}>
                    ${(t?.oi ?? m.baseOi).toFixed(1)}M OI
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {t
                    ? <Num value={t.price} sym={m.symbol} className="text-[11px] block text-[#d8e0f0]" />
                    : <span style={{ fontSize: 10, color: '#2e3450' }}>—</span>
                  }
                  {t && <Chg v={t.change} className="text-[10px] justify-end mt-0.5" />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ CENTER — Chart ════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Ticker bar */}
        <div style={{ borderBottom: '1px solid #111525', background: '#0b0d16', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 10, height: 44, overflow: 'hidden', flexShrink: 0 }}>
          {/* Symbol */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: '#e2e8f6', letterSpacing: '-0.01em' }}>{mkt.symbol}<span style={{ color: '#2e3450', fontSize: 11, fontWeight: 500 }}>/PERP</span></span>
            {tick
              ? <Num value={tick.price} sym={mkt.symbol} large className="text-[16px] text-[#e2e8f6]" />
              : <span style={{ fontSize: 16, color: '#2e3450' }}>…</span>
            }
            {tick && <Chg v={tick.change} className="text-[11px]" />}
            {isLive && <span className="feed-dot feed-dot-green" />}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: '#111525', flexShrink: 0 }} />

          {/* Stats */}
          {tick && (
            <div style={{ display: 'flex', gap: 6, overflow: 'hidden', alignItems: 'center' }}>
              <div className="stat-pill">
                <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600 }}>24H HIGH</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#00d084' }}>{fmtP(tick.high, mkt.symbol)}</span>
              </div>
              <div className="stat-pill">
                <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600 }}>24H LOW</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#ff3b5c' }}>{fmtP(tick.low, mkt.symbol)}</span>
              </div>
              <div className="stat-pill">
                <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600 }}>VOL</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#a0aac0' }}>${tick.vol.toFixed(0)}M</span>
              </div>
              <div className="stat-pill">
                <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600 }}>OI</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#a0aac0' }}>${tick.oi.toFixed(1)}M</span>
              </div>
              <div className="stat-pill">
                <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600 }}>FUND/HR</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600,
                  color: tick.funding >= 0 ? '#00d084' : '#ff3b5c' }}>
                  {tick.funding >= 0 ? '+' : ''}{(tick.funding * 100).toFixed(4)}%
                </span>
              </div>
              <div className="stat-pill">
                <Clock size={9} style={{ color: '#3a4560' }} />
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#a0aac0' }}>{fmtTimer(tick.nextFundSec)}</span>
              </div>
            </div>
          )}

          {/* Interval selector — pushed to right */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 1, flexShrink: 0 }}>
            {IVLS.map(iv => (
              <button key={iv.id} className={clsx('iv-btn', interval === iv.id && 'active')}
                onClick={() => setInterval_(iv.id)}>
                {iv.l}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TvChart symbol={selected} interval={interval} />
        </div>
      </div>

      {/* ═══ RIGHT — Order panel ═══════════════════════════════════════════ */}
      <div style={{ borderLeft: '1px solid #111525', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#090c17' }}>

        {/* Header */}
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #111525', background: '#0b0e1a' }}>
          <div style={{ fontSize: 10, color: '#3a4560', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {mkt.symbol}-PERP · Place Order
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {tick
              ? <Num value={tick.price} sym={mkt.symbol} large className="text-[20px] text-[#e2e8f6]" />
              : <span style={{ fontSize: 20, color: '#2e3450', fontFamily: 'JetBrains Mono' }}>—</span>
            }
            {tick && <Chg v={tick.change} className="text-[11px]" />}
          </div>
          {tick && (
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 9, color: '#2e3450' }}>
                H: <span style={{ color: '#3a5540', fontFamily: 'JetBrains Mono' }}>{fmtP(tick.high, mkt.symbol)}</span>
              </span>
              <span style={{ fontSize: 9, color: '#2e3450' }}>
                L: <span style={{ color: '#553a40', fontFamily: 'JetBrains Mono' }}>{fmtP(tick.low, mkt.symbol)}</span>
              </span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Order type tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #111525', marginBottom: 2 }}>
            {(['market', 'limit', 'tp/sl'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)}
                style={{
                  padding: '5px 10px', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  borderBottom: orderType === t ? '2px solid #00d084' : '2px solid transparent',
                  color: orderType === t ? '#00d084' : '#2e3450',
                  transition: 'all 0.1s', marginBottom: -1,
                }}>
                {t}
              </button>
            ))}
          </div>

          {/* Long / Short */}
          <div style={{ display: 'flex', border: '1px solid #181c2e', borderRadius: 5, overflow: 'hidden' }}>
            <button className={clsx('side-btn-long', side === 'long' && 'active')} onClick={() => setSide('long')}>
              <TrendingUp size={11} style={{ display: 'inline', marginRight: 4 }} />
              LONG
            </button>
            <div style={{ width: 1, background: '#181c2e' }} />
            <button className={clsx('side-btn-short', side === 'short' && 'active')} onClick={() => setSide('short')}>
              <TrendingDown size={11} style={{ display: 'inline', marginRight: 4 }} />
              SHORT
            </button>
          </div>

          {/* Leverage */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 9, color: '#3a4560', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Leverage</span>
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700, color: '#e2e8f6' }}>{leverage}×</span>
            </div>
            <input type="range" min={1} max={50} value={leverage} onChange={e => setLeverage(+e.target.value)}
              className="lev-slider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              {[2, 5, 10, 20, 50].map(l => (
                <button key={l} onClick={() => setLeverage(l)}
                  style={{
                    padding: '3px 6px', fontSize: 9, fontWeight: 700, borderRadius: 3,
                    background: leverage === l ? '#00d08418' : '#0d1020',
                    color: leverage === l ? '#00d084' : '#2e3450',
                    border: `1px solid ${leverage === l ? '#00d08430' : '#181c2e'}`,
                    transition: 'all 0.08s', letterSpacing: '0.04em',
                  }}>
                  {l}×
                </button>
              ))}
            </div>
          </div>

          {/* Limit price */}
          {orderType === 'limit' && (
            <div>
              <label style={{ fontSize: 9, color: '#3a4560', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Limit Price</label>
              <div className="trade-input-wrap">
                <div style={{ fontSize: 9, color: '#2e3450', marginBottom: 2 }}>USD</div>
                <input type="number" value={limitPx} onChange={e => setLimitPx(e.target.value)}
                  placeholder={tick ? fmtP(tick.price, mkt.symbol).replace('$', '') : '0.00'}
                  className="trade-input" />
              </div>
            </div>
          )}

          {/* Size */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <label style={{ fontSize: 9, color: '#3a4560', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Size</label>
              {sizeNum > 0 && tick && (
                <span style={{ fontSize: 9, color: '#2e3450', fontFamily: 'JetBrains Mono' }}>
                  ≈ {fmtP(sizeNum * (tick.price ?? 0), mkt.symbol)} notional
                </span>
              )}
            </div>
            <div className="trade-input-wrap">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <input type="number" value={size} onChange={e => { setSize(e.target.value); setPct(null) }}
                  placeholder="0.00" className="trade-input" style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: '#3a4560', fontWeight: 600, marginLeft: 6 }}>{mkt.symbol}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} className={clsx('pct-btn', pct === p && 'sel')}
                  onClick={() => { setPct(p); setSize('') }}>
                  {p}%
                </button>
              ))}
            </div>
          </div>

          {/* Order summary */}
          {tick && (
            <div style={{ background: '#0a0d18', border: '1px solid #111525', borderRadius: 5, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#2e3450', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Order Summary</div>
              {[
                { label: 'Entry Price', val: fmtP(orderType === 'limit' && limitPx ? parseFloat(limitPx) : tick.price, mkt.symbol), color: '#a0aac0' },
                ...(sizeNum > 0 ? [
                  { label: 'Position Size', val: `${sizeNum} ${mkt.symbol}`, color: '#a0aac0' },
                  { label: 'Notional', val: `$${notional.toFixed(2)}`, color: '#a0aac0' },
                  { label: 'Margin Req.', val: `$${margin.toFixed(2)}`, color: '#a0aac0' },
                  { label: 'Liq. Price', val: fmtP(liqPx, mkt.symbol), color: side === 'long' ? '#ff3b5c' : '#00d084' },
                  { label: 'Fee (0.01%)', val: `$${(notional * 0.0001).toFixed(3)}`, color: '#a0aac0' },
                ] : []),
                { label: 'Funding / Hr', val: `${(tick.funding >= 0 && side === 'long') || (tick.funding < 0 && side === 'short') ? '−' : '+'}${Math.abs(tick.funding * 100).toFixed(4)}%`,
                  color: (tick.funding >= 0 && side === 'long') || (tick.funding < 0 && side === 'short') ? '#ff3b5c' : '#00d084' },
              ].map(r => (
                <div key={r.label} className="ord-row">
                  <span style={{ fontSize: 10, color: '#3a4560' }}>{r.label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 600, color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warning */}
          <div style={{ display: 'flex', gap: 6, background: '#f5b24b09', border: '1px solid #f5b24b18', borderRadius: 5, padding: '7px 9px', alignItems: 'flex-start' }}>
            <AlertTriangle size={11} style={{ color: '#f5b24b', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 10, color: '#7a6030', lineHeight: 1.5 }}>Perpetuals require USDC. Up to {leverage}× leverage increases both profit and loss.</span>
          </div>

          {/* Execute */}
          <button className={side === 'long' ? 'perp-execute-long' : 'perp-execute-short'}>
            {side === 'long'
              ? <><TrendingUp size={12} style={{ display: 'inline', marginRight: 6 }} />Long {mkt.symbol} · {leverage}×</>
              : <><TrendingDown size={12} style={{ display: 'inline', marginRight: 6 }} />Short {mkt.symbol} · {leverage}×</>
            }
          </button>

          {/* Funding / countdown */}
          {tick && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 4 }}>
              <Clock size={9} style={{ color: '#2e3450' }} />
              <span style={{ fontSize: 9, color: '#2e3450' }}>Next funding in</span>
              <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono', color: '#4a5580' }}>{fmtTimer(tick.nextFundSec)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
