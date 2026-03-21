import { useState } from 'react'
import { TrendingUp, TrendingDown, Zap, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

const PERP_MARKETS = [
  { symbol: 'BTC', price: 97420, change: 2.3,  funding: 0.01, oi: 42.5, vol: 1200 },
  { symbol: 'ETH', price: 3840,  change: -1.2, funding: -0.02, oi: 18.2, vol: 480 },
  { symbol: 'SOL', price: 185,   change: 4.1,  funding: 0.04, oi: 8.6,  vol: 220 },
  { symbol: 'WIF', price: 2.34,  change: -8.4, funding: -0.08, oi: 1.2, vol: 45 },
  { symbol: 'BONK', price: 0.000028, change: 12.5, funding: 0.12, oi: 0.8, vol: 30 },
]

export function PerpetualsPage() {
  const [selected, setSelected] = useState('SOL')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)

  const market = PERP_MARKETS.find(m => m.symbol === selected) ?? PERP_MARKETS[2]
  const notional = (parseFloat(size) || 0) * leverage * (market.price > 1 ? market.price : 1)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Market list */}
      <div className="w-56 shrink-0 border-r border-ax-border flex flex-col overflow-y-auto">
        <div className="px-3 py-2 border-b border-ax-border text-xs font-semibold text-text-secondary">Markets</div>
        {PERP_MARKETS.map(m => (
          <button
            key={m.symbol}
            onClick={() => setSelected(m.symbol)}
            className={clsx('flex items-center justify-between px-3 py-2.5 text-left transition-colors border-b border-ax-border/50 hover:bg-ax-hover',
              selected === m.symbol && 'bg-ax-active border-l-2 border-l-green-DEFAULT')}
          >
            <div>
              <div className="text-xs font-bold text-text-primary">{m.symbol}-PERP</div>
              <div className="text-2xs text-text-muted">${m.oi.toFixed(1)}M OI</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-text-primary">${m.price < 0.001 ? m.price.toFixed(8) : m.price.toFixed(m.price < 1 ? 4 : 2)}</div>
              <div className={clsx('text-2xs font-mono', m.change >= 0 ? 'pos' : 'neg')}>{m.change >= 0 ? '+' : ''}{m.change}%</div>
            </div>
          </button>
        ))}
      </div>

      {/* Trading area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mock chart area */}
        <div className="flex-1 bg-ax-base flex flex-col items-center justify-center gap-4 text-text-muted">
          <div className="text-6xl font-bold font-mono text-text-primary">${market.price.toLocaleString()}</div>
          <div className={clsx('text-lg font-mono', market.change >= 0 ? 'pos' : 'neg')}>
            {market.change >= 0 ? <TrendingUp className="inline mr-1" size={18} /> : <TrendingDown className="inline mr-1" size={18} />}
            {market.change >= 0 ? '+' : ''}{market.change}%
          </div>
          <div className="flex gap-6 text-sm text-text-secondary">
            <span>Vol: ${market.vol}M</span>
            <span>OI: ${market.oi}M</span>
            <span>Funding: <span className={market.funding >= 0 ? 'pos' : 'neg'}>{market.funding > 0 ? '+' : ''}{market.funding}%/hr</span></span>
          </div>
          <div className="px-6 py-3 bg-ax-card border border-ax-border rounded-xl text-xs text-text-muted text-center max-w-sm">
            Full perpetuals trading requires connecting to a derivatives protocol.<br/>
            <a href="https://axiom.trade/perpetuals" target="_blank" rel="noopener noreferrer" className="text-green-DEFAULT hover:underline mt-1 inline-block">Open in Axiom Pro ↗</a>
          </div>
        </div>

        {/* Order panel */}
        <div className="w-64 shrink-0 border-l border-ax-border flex flex-col overflow-y-auto p-3 gap-3">
          <div className="text-sm font-bold text-text-primary">{selected}-PERP</div>

          <div className="flex rounded-lg overflow-hidden border border-ax-border">
            <button onClick={() => setSide('long')} className={clsx('flex-1 py-2 text-xs font-bold transition-colors', side === 'long' ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card text-text-muted hover:text-text-primary')}>LONG</button>
            <button onClick={() => setSide('short')} className={clsx('flex-1 py-2 text-xs font-bold transition-colors', side === 'short' ? 'bg-red-DEFAULT text-white' : 'bg-ax-card text-text-muted hover:text-text-primary')}>SHORT</button>
          </div>

          {/* Leverage */}
          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-1.5">
              <span>Leverage</span><span className="font-mono text-text-primary font-bold">{leverage}x</span>
            </div>
            <input type="range" min={1} max={50} value={leverage} onChange={e => setLeverage(+e.target.value)}
              className="w-full accent-green-DEFAULT" />
            <div className="flex justify-between text-2xs text-text-muted mt-1"><span>1x</span><span>50x</span></div>
          </div>

          {/* Size */}
          <div className="ax-input p-2.5 rounded-lg">
            <div className="text-2xs text-text-muted mb-1">Size (SOL)</div>
            <input type="number" value={size} onChange={e => setSize(e.target.value)} placeholder="0.00"
              className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
          </div>

          {/* Info */}
          {size && (
            <div className="text-2xs space-y-1 animate-fade-in">
              <div className="flex justify-between"><span className="text-text-muted">Notional</span><span className="text-text-primary font-mono">${notional.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Leverage</span><span className="text-text-primary font-mono">{leverage}x</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Liq. Price (est.)</span>
                <span className={side === 'long' ? 'neg' : 'pos'} style={{ fontFamily: 'monospace' }}>
                  ${(market.price * (side === 'long' ? 1 - 1 / leverage : 1 + 1 / leverage)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-text-muted">Fee (0.01%)</span><span className="text-text-primary font-mono">${(notional * 0.0001).toFixed(2)}</span></div>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-ax-card border border-yellow-DEFAULT/20 rounded-lg p-2.5 text-2xs text-yellow-DEFAULT">
            <AlertTriangle size={11} className="shrink-0" />
            <span>Perpetuals require USDC. Up to 50x leverage.</span>
          </div>

          <button
            className={clsx('w-full py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
              side === 'long' ? 'btn-buy' : 'btn-sell')}
          >
            <Zap size={12} />
            {side === 'long' ? 'Long' : 'Short'} {selected}
          </button>
        </div>
      </div>
    </div>
  )
}
