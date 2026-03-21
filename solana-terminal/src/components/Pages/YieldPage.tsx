import { useState } from 'react'
import { TrendingUp, Shield, Zap, ExternalLink } from 'lucide-react'
import clsx from 'clsx'

const PROTOCOLS = [
  { name: 'Marginfi',  asset: 'USDC', apy: 8.4,  tvl: 245, risk: 'Low',  logo: '🔵', color: '#3772ff' },
  { name: 'Kamino',    asset: 'USDC', apy: 11.2, tvl: 180, risk: 'Low',  logo: '🟣', color: '#9b5de5' },
  { name: 'Marginfi',  asset: 'SOL',  apy: 6.8,  tvl: 89,  risk: 'Med',  logo: '🔵', color: '#3772ff' },
  { name: 'Kamino',    asset: 'SOL',  apy: 9.1,  tvl: 67,  risk: 'Med',  logo: '🟣', color: '#9b5de5' },
  { name: 'Drift',     asset: 'USDC', apy: 14.5, tvl: 120, risk: 'Med',  logo: '🟡', color: '#f5b24b' },
  { name: 'Solend',    asset: 'USDC', apy: 7.2,  tvl: 310, risk: 'Low',  logo: '🟢', color: '#16c784' },
]

export function YieldPage() {
  const [selected, setSelected] = useState<typeof PROTOCOLS[0] | null>(null)
  const [amount, setAmount] = useState('')

  const totalTvl = PROTOCOLS.reduce((s, p) => s + p.tvl, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total TVL', value: `$${totalTvl}M`, icon: <Shield size={14} />, color: 'text-green-DEFAULT' },
          { label: 'Best APY', value: `${Math.max(...PROTOCOLS.map(p => p.apy)).toFixed(1)}%`, icon: <TrendingUp size={14} />, color: 'text-green-DEFAULT' },
          { label: 'Protocols', value: String(new Set(PROTOCOLS.map(p => p.name)).size), icon: <Zap size={14} />, color: 'text-blue-accent' },
        ].map(s => (
          <div key={s.label} className="panel p-3 flex items-center gap-3">
            <div className={clsx('text-text-muted', s.color)}>{s.icon}</div>
            <div>
              <div className="text-2xs text-text-muted">{s.label}</div>
              <div className={clsx('text-lg font-bold font-mono', s.color)}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Protocol table */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1 panel overflow-hidden flex flex-col">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] text-2xs text-text-muted border-b border-ax-border px-4 py-2 font-medium">
            <div>Protocol</div><div className="text-right">Asset</div><div className="text-right">APY</div>
            <div className="text-right">TVL</div><div className="text-right">Risk</div><div className="text-center">Action</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {PROTOCOLS.map((p, i) => (
              <div key={i}
                onClick={() => setSelected(p)}
                className={clsx('grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] items-center px-4 py-2.5 border-b border-ax-border/50 cursor-pointer hover:bg-ax-hover transition-colors',
                  selected === p && 'bg-ax-active border-l-2 border-l-green-DEFAULT')}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{p.logo}</span>
                  <span className="text-xs font-semibold text-text-primary">{p.name}</span>
                </div>
                <div className="text-right text-xs font-mono text-text-secondary">{p.asset}</div>
                <div className="text-right text-xs font-bold font-mono text-green-DEFAULT">+{p.apy}%</div>
                <div className="text-right text-xs font-mono text-text-primary">${p.tvl}M</div>
                <div className="text-right">
                  <span className={clsx('badge', p.risk === 'Low' ? 'badge-green' : 'badge-yellow')}>{p.risk}</span>
                </div>
                <div className="flex justify-center">
                  <button className="btn-buy px-2 py-1 text-2xs" onClick={e => { e.stopPropagation(); setSelected(p) }}>
                    Deposit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Deposit panel */}
        <div className="w-64 shrink-0 panel p-4 flex flex-col gap-3">
          <div className="text-sm font-bold text-text-primary">
            {selected ? `${selected.name} — ${selected.asset}` : 'Select a protocol'}
          </div>
          {selected ? (
            <>
              <div className="bg-ax-card border border-ax-border rounded-xl p-3">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-text-muted">APY</span>
                  <span className="text-green-DEFAULT font-bold">+{selected.apy}%</span>
                </div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-text-muted">TVL</span>
                  <span className="text-text-primary">${selected.tvl}M</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Risk</span>
                  <span className={clsx('badge', selected.risk === 'Low' ? 'badge-green' : 'badge-yellow')}>{selected.risk}</span>
                </div>
              </div>

              <div className="ax-input p-2.5 rounded-lg">
                <div className="text-2xs text-text-muted mb-1">Amount ({selected.asset})</div>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                  className="w-full bg-transparent text-sm font-mono text-text-primary outline-none" />
              </div>

              {amount && (
                <div className="text-2xs space-y-1.5 animate-fade-in">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Daily earnings</span>
                    <span className="text-green-DEFAULT font-mono">+${(parseFloat(amount) * selected.apy / 100 / 365).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Monthly earnings</span>
                    <span className="text-green-DEFAULT font-mono">+${(parseFloat(amount) * selected.apy / 100 / 12).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Yearly earnings</span>
                    <span className="text-green-DEFAULT font-mono">+${(parseFloat(amount) * selected.apy / 100).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button className="btn-buy w-full py-2.5 text-xs font-bold flex items-center justify-center gap-1.5">
                <Zap size={12} />
                Deposit {selected.asset}
              </button>
              <a href="https://axiom.trade/yield" target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 text-2xs text-text-muted hover:text-green-DEFAULT transition-colors">
                <ExternalLink size={10} /> Open full yield page
              </a>
            </>
          ) : (
            <div className="text-xs text-text-muted text-center py-8">
              Select a protocol from the list to deposit and earn yield
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
