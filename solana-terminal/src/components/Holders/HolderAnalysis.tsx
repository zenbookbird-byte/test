import { useTerminalStore } from '../../store/terminalStore'
import { formatNumber, formatPercent } from '../../services/dexscreener'
import { Shield, AlertTriangle, TrendingUp, Users, Droplets, BarChart2 } from 'lucide-react'
import clsx from 'clsx'

// Jeet Score color mapping
function jeetColor(score: number) {
  if (score >= 80) return 'bg-accent-green text-bg-base'
  if (score >= 60) return 'bg-accent-green/70 text-bg-base'
  if (score >= 40) return 'bg-accent-yellow text-bg-base'
  if (score >= 20) return 'bg-accent-orange text-bg-base'
  return 'bg-accent-red text-white'
}

// Derive a pseudo-jeet score from on-chain data we have
function computeJeetScore(pair: {
  txns?: { h1?: { buys: number; sells: number }; h24?: { buys: number; sells: number } }
  priceChange?: { h1?: number; h24?: number; m5?: number }
  liquidity?: { usd?: number }
  volume?: { h24?: number; h1?: number }
  marketCap?: number
  fdv?: number
}) {
  let score = 50
  const h1 = pair.txns?.h1

  if (h1) {
    const total = h1.buys + h1.sells
    if (total > 0) {
      const buyRatio = h1.buys / total
      score += (buyRatio - 0.5) * 40
    }
  }
  const c1h = pair.priceChange?.h1 ?? 0
  const c24 = pair.priceChange?.h24 ?? 0
  score += Math.min(15, Math.max(-15, c1h * 0.5))
  score += Math.min(10, Math.max(-10, c24 * 0.2))
  const liq = pair.liquidity?.usd ?? 0
  const mc = pair.marketCap ?? pair.fdv ?? 0
  if (mc > 0 && liq > 0) {
    const ratio = liq / mc
    if (ratio > 0.05) score += 10
    else if (ratio < 0.01) score -= 15
  }
  return Math.min(100, Math.max(0, Math.round(score)))
}

export function HolderAnalysis() {
  const { selectedPair } = useTerminalStore()

  if (!selectedPair) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
        <Users size={24} className="opacity-30" />
        <span className="text-xs">Select a token to view analytics</span>
      </div>
    )
  }

  const p = selectedPair
  const jeetScore = computeJeetScore(p)
  const buys24 = p.txns?.h24?.buys ?? 0
  const sells24 = p.txns?.h24?.sells ?? 0
  const total24 = buys24 + sells24
  const buyPct24 = total24 > 0 ? (buys24 / total24) * 100 : 50

  const buys1h = p.txns?.h1?.buys ?? 0
  const sells1h = p.txns?.h1?.sells ?? 0
  const total1h = buys1h + sells1h
  const buyPct1h = total1h > 0 ? (buys1h / total1h) * 100 : 50

  const buys5m = p.txns?.m5?.buys ?? 0
  const sells5m = p.txns?.m5?.sells ?? 0
  const total5m = buys5m + sells5m
  const buyPct5m = total5m > 0 ? (buys5m / total5m) * 100 : 50

  const liqMcRatio = p.marketCap ? ((p.liquidity?.usd ?? 0) / p.marketCap) * 100 : 0

  // Risk flags
  const flags: { label: string; ok: boolean; detail: string }[] = [
    {
      label: 'Liquidity / MCap',
      ok: liqMcRatio > 3,
      detail: `${liqMcRatio.toFixed(1)}% — ${liqMcRatio > 3 ? 'Healthy' : 'Low, rug risk'}`,
    },
    {
      label: 'Buy Pressure 1h',
      ok: buyPct1h > 45,
      detail: `${buyPct1h.toFixed(0)}% buys — ${buyPct1h > 55 ? 'Strong' : buyPct1h > 45 ? 'Neutral' : 'Selling pressure'}`,
    },
    {
      label: 'Price Momentum',
      ok: (p.priceChange?.h1 ?? 0) > -10,
      detail: `${formatPercent(p.priceChange?.h1)} (1h)`,
    },
    {
      label: 'Volume Consistency',
      ok: (p.volume?.h1 ?? 0) * 24 * 0.5 < (p.volume?.h24 ?? 1),
      detail: `Vol 1h: ${formatNumber(p.volume?.h1)}`,
    },
  ]

  // Jeet grid cells — color coded by buy ratio in that period
  const gridCells = [
    { label: '5m', buy: buyPct5m, total: total5m },
    { label: '1h', buy: buyPct1h, total: total1h },
    { label: '6h', buy: (p.txns?.h6?.buys ?? 0) / Math.max((p.txns?.h6?.buys ?? 0) + (p.txns?.h6?.sells ?? 0), 1) * 100, total: (p.txns?.h6?.buys ?? 0) + (p.txns?.h6?.sells ?? 0) },
    { label: '24h', buy: buyPct24, total: total24 },
  ]

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {/* Jeet Score */}
      <div className="bg-bg-tertiary border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Jeet Score™</span>
          <div className={clsx('text-xs font-bold px-2 py-0.5 rounded-full', jeetColor(jeetScore))}>
            {jeetScore}/100
          </div>
        </div>
        <div className="h-2 bg-bg-card rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', jeetScore >= 60 ? 'bg-accent-green' : jeetScore >= 40 ? 'bg-accent-yellow' : 'bg-accent-red')}
            style={{ width: `${jeetScore}%` }}
          />
        </div>
        <div className="text-xs text-text-muted mt-1.5">
          {jeetScore >= 70 ? 'Strong holders — low jeet risk' :
           jeetScore >= 50 ? 'Mixed sentiment — moderate risk' :
           jeetScore >= 30 ? 'Selling pressure detected' :
           'High jeet risk — be cautious'}
        </div>
      </div>

      {/* Jeet Grid */}
      <div>
        <div className="text-xs text-text-muted mb-2 uppercase tracking-wider font-semibold">Buy/Sell Grid</div>
        <div className="grid grid-cols-4 gap-1.5">
          {gridCells.map(cell => {
            const buyRatio = cell.buy
            const bg = buyRatio >= 65 ? 'bg-accent-green/20 border-accent-green/30' :
                       buyRatio >= 50 ? 'bg-accent-green/10 border-accent-green/20' :
                       buyRatio >= 35 ? 'bg-accent-red/10 border-accent-red/20' :
                                        'bg-accent-red/20 border-accent-red/30'
            const textColor = buyRatio >= 50 ? 'text-accent-green' : 'text-accent-red'
            return (
              <div key={cell.label} className={clsx('rounded-lg border p-2 text-center', bg)}>
                <div className="text-xs text-text-muted mb-0.5">{cell.label}</div>
                <div className={clsx('text-sm font-bold', textColor)}>{buyRatio.toFixed(0)}%</div>
                <div className="text-xs text-text-muted">{cell.total} txns</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Buy/Sell bars */}
      <div className="bg-bg-tertiary border border-border rounded-xl p-3 space-y-2.5">
        <div className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-1">Transaction Flow</div>
        {[
          { label: '5m', buys: buys5m, sells: sells5m, total: total5m },
          { label: '1h', buys: buys1h, sells: sells1h, total: total1h },
          { label: '24h', buys: buys24, sells: sells24, total: total24 },
        ].map(row => {
          const bp = row.total ? (row.buys / row.total) * 100 : 50
          return (
            <div key={row.label} className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted w-6">{row.label}</span>
                <span className="text-accent-green">{row.buys}B</span>
                <span className="text-text-muted flex-1 text-center">{row.total} total</span>
                <span className="text-accent-red">{row.sells}S</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-accent-red/30">
                <div className="bg-accent-green rounded-full" style={{ width: `${bp}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Risk flags */}
      <div className="bg-bg-tertiary border border-border rounded-xl p-3">
        <div className="text-xs text-text-muted uppercase tracking-wider font-semibold mb-2">Risk Analysis</div>
        <div className="space-y-2">
          {flags.map(flag => (
            <div key={flag.label} className="flex items-start gap-2">
              {flag.ok
                ? <Shield size={12} className="text-accent-green mt-0.5 shrink-0" />
                : <AlertTriangle size={12} className="text-accent-orange mt-0.5 shrink-0" />
              }
              <div>
                <div className="text-xs text-text-primary">{flag.label}</div>
                <div className="text-xs text-text-muted">{flag.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatTile icon={<Droplets size={12} />} label="Liquidity" value={formatNumber(p.liquidity?.usd)} />
        <StatTile icon={<BarChart2 size={12} />} label="FDV" value={formatNumber(p.fdv)} />
        <StatTile icon={<TrendingUp size={12} />} label="Vol/MCap" value={p.marketCap ? `${((p.volume?.h24 ?? 0) / p.marketCap * 100).toFixed(1)}%` : '—'} />
        <StatTile icon={<Users size={12} />} label="Liq/MCap" value={liqMcRatio > 0 ? `${liqMcRatio.toFixed(1)}%` : '—'} />
      </div>
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-bg-tertiary border border-border rounded-lg p-2">
      <div className="flex items-center gap-1 text-xs text-text-muted mb-0.5">
        {icon}{label}
      </div>
      <div className="text-sm font-mono font-semibold text-text-primary">{value}</div>
    </div>
  )
}
