import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getTokenPrice, SOL_MINT } from '../../services/jupiter'
import { Wallet, Users, Compass, Zap, TrendingUp, Cpu, Twitter, MessageCircle, BookOpen, Globe, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

export function BottomBar() {
  const { activePreset, setActivePreset, pageView, setPageView } = useTerminalStore()
  const { connected } = useWallet()
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [tps, setTps] = useState(Math.floor(2800 + Math.random() * 800))
  const [ethPrice] = useState(3840)
  const [btcPrice] = useState(97420)
  const [region] = useState('EU-C')

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
    <footer className="h-8 bg-ax-nav border-t border-ax-border flex items-center px-2 gap-0 shrink-0 z-50 select-none overflow-x-auto">
      {/* Presets */}
      <div className="flex items-center gap-0.5 border-r border-ax-border pr-2 mr-2 shrink-0">
        {PRESETS.map((p, i) => (
          <button
            key={p}
            onClick={() => setActivePreset(i + 1)}
            className={clsx(
              'text-2xs font-bold px-2 py-0.5 rounded transition-colors',
              activePreset === i + 1
                ? 'bg-green-DEFAULT text-ax-base'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Wallet count indicators */}
      <div className="hidden md:flex items-center gap-1 border-r border-ax-border pr-2 mr-2 shrink-0 text-2xs text-text-muted">
        <span className="font-mono">◎ 1</span>
        <span className="text-ax-bordl">|</span>
        <span className="font-mono">🪙 0</span>
        <span className="text-ax-bordl">|</span>
        <span className="text-green-DEFAULT font-mono">▶ 0</span>
      </div>

      {/* Status buttons */}
      <div className="flex items-center gap-0.5 shrink-0">
        {[
          { icon: <Wallet size={9} />, label: 'Wallet',   dot: connected ? 'green' : 'red',  page: null },
          { icon: <Users size={9} />,  label: 'Social',   dot: 'green',                       page: null },
          { icon: <Compass size={9} />, label: 'Discover', dot: 'green',                      page: 'discover' as const },
          { icon: <Zap size={9} />,    label: 'Pulse',    dot: 'green',                       page: 'pulse' as const },
          { icon: <TrendingUp size={9} />, label: 'PnL',  dot: 'gray',                        page: null },
          { icon: <span className="text-2xs font-bold">α</span>, label: 'Alpha', dot: 'green', page: 'vision' as const },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => item.page && setPageView(item.page)}
            className={clsx('flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded transition-colors',
              item.page && pageView === item.page ? 'text-text-primary bg-ax-card' : 'text-text-muted hover:text-text-primary hover:bg-ax-card/50'
            )}>
            {item.icon}
            <span className="hidden sm:inline">{item.label}</span>
            <span className={clsx('w-1 h-1 rounded-full',
              item.dot === 'green' ? 'bg-green-DEFAULT' : item.dot === 'red' ? 'bg-red-DEFAULT' : 'bg-ax-bordl'
            )} />
          </button>
        ))}
      </div>

      {/* Right: prices + social + network */}
      <div className="flex items-center gap-2 ml-auto text-2xs text-text-muted shrink-0">
        {/* Price tickers */}
        <div className="hidden lg:flex items-center gap-2 border-r border-ax-border pr-2">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
            <span className="font-mono text-text-secondary">${btcPrice.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-accent shrink-0" />
            <span className="font-mono text-text-secondary">${ethPrice.toLocaleString()}</span>
          </div>
          {solPrice && (
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-purple-DEFAULT to-blue-accent shrink-0" />
              <span className="font-mono text-text-secondary">${solPrice.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* TPS */}
        <div className="hidden md:flex items-center gap-1 border-r border-ax-border pr-2">
          <Cpu size={9} />
          <span className="font-mono">{tps.toLocaleString()}</span>
        </div>

        {/* Online users */}
        <div className="hidden md:flex items-center gap-1 border-r border-ax-border pr-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-DEFAULT" />
          <span className="font-mono">{(728000 + Math.floor(Math.random() * 1000)).toLocaleString()}</span>
        </div>

        {/* Region */}
        <button className="hidden lg:flex items-center gap-0.5 hover:text-text-primary transition-colors border-r border-ax-border pr-2">
          <Globe size={9} />
          {region}
          <ChevronDown size={8} />
        </button>

        {/* Connected */}
        <div className={clsx('flex items-center gap-1 border-r border-ax-border pr-2',
          connected ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-DEFAULT animate-pulse' : 'bg-red-DEFAULT')} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Social links */}
        <div className="flex items-center gap-1.5">
          <a href="#" target="_blank" rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"><Twitter size={10} /></a>
          <a href="#" target="_blank" rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"><MessageCircle size={10} /></a>
          <a href="#" target="_blank" rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors flex items-center gap-0.5">
            <BookOpen size={9} />
            <span className="hidden lg:inline">Docs</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
