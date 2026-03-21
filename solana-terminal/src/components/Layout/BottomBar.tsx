import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getTokenPrice, SOL_MINT } from '../../services/jupiter'
import { Wallet, Users, Compass, Zap, TrendingUp, Cpu, ExternalLink, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

export function BottomBar() {
  const { quickBuyPreset, setQuickBuyPreset, activePreset, setActivePreset } = useTerminalStore()
  const { connected } = useWallet()
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [tps, setTps] = useState(Math.floor(2800 + Math.random() * 800))

  useEffect(() => {
    getTokenPrice(SOL_MINT).then(p => p && setSolPrice(p))
    const interval = setInterval(() => {
      getTokenPrice(SOL_MINT).then(p => p && setSolPrice(p))
      setTps(Math.floor(2800 + Math.random() * 800))
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const PRESETS = ['PRESET 1', 'PRESET 2', 'PRESET 3']

  return (
    <footer className="h-8 bg-ax-nav border-t border-ax-border flex items-center px-3 gap-0 shrink-0 z-50 select-none">
      {/* Presets */}
      <div className="flex items-center gap-0.5 border-r border-ax-border pr-2 mr-2">
        {PRESETS.map((p, i) => (
          <button
            key={p}
            onClick={() => setActivePreset(i + 1)}
            className={clsx(
              'text-2xs font-semibold px-2 py-0.5 rounded transition-colors',
              activePreset === i + 1
                ? 'bg-green-DEFAULT text-ax-base'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Quick Buy amount */}
      <div className="flex items-center gap-1 border-r border-ax-border pr-2 mr-2">
        <span className="text-2xs text-text-muted">Quick Buy</span>
        <input
          type="number"
          value={quickBuyPreset}
          onChange={e => setQuickBuyPreset(parseFloat(e.target.value) || 0)}
          className="w-14 ax-input px-1.5 py-0.5 text-2xs text-right rounded"
          step="0.1"
          min="0"
        />
        <span className="text-2xs text-text-muted">SOL</span>
      </div>

      {/* Status buttons */}
      <div className="flex items-center gap-0.5">
        {[
          { icon: <Wallet size={10} />, label: 'Wallet', dot: connected ? 'green' : 'red' },
          { icon: <Users size={10} />,  label: 'Social', dot: 'green' },
          { icon: <Compass size={10} />, label: 'Discover', dot: 'green' },
          { icon: <Zap size={10} />,    label: 'Pulse', dot: 'green' },
          { icon: <TrendingUp size={10} />, label: 'PnL', dot: 'gray' },
        ].map(item => (
          <button key={item.label} className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-ax-card transition-colors">
            {item.icon}
            {item.label}
            <span className={clsx('w-1 h-1 rounded-full', item.dot === 'green' ? 'bg-green-DEFAULT' : item.dot === 'red' ? 'bg-red-DEFAULT' : 'bg-ax-bordl')} />
          </button>
        ))}
      </div>

      {/* Right: prices + network */}
      <div className="flex items-center gap-3 ml-auto text-2xs text-text-muted">
        {solPrice && (
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-purple-DEFAULT to-blue-accent shrink-0" />
            <span className="font-mono text-text-primary">${solPrice.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Cpu size={10} />
          <span className="font-mono">{tps.toLocaleString()} TPS</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-DEFAULT animate-pulse" />
          <span>Connected</span>
        </div>
        <a href="https://docs.axiom.trade" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-0.5 hover:text-text-primary transition-colors">
          Docs <ExternalLink size={9} />
        </a>
      </div>
    </footer>
  )
}
