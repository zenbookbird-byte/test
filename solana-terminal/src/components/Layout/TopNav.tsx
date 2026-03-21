import { useState, useRef, useEffect } from 'react'
import { Search, Bell, Star, ChevronDown, X, Download, Settings, User } from 'lucide-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTerminalStore } from '../../store/terminalStore'
import { useSearchPairs } from '../../hooks/useTokenPairs'
import { formatPercent } from '../../services/dexscreener'
import type { TokenPair } from '../../types'
import type { PageView } from '../../store/terminalStore'
import clsx from 'clsx'

const NAV_ITEMS: { id: PageView; label: string; badge?: string }[] = [
  { id: 'discover',    label: 'Discover' },
  { id: 'pulse',       label: 'Pulse' },
  { id: 'trackers',    label: 'Trackers' },
  { id: 'perpetuals',  label: 'Perpetuals' },
  { id: 'yield',       label: 'Yield' },
  { id: 'portfolio',   label: 'Portfolio' },
]

export function TopNav() {
  const { pageView, setPageView, setSelectedPair, setSearchQuery } = useTerminalStore()
  const { connected, publicKey } = useWallet()
  const [localQuery, setLocalQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: results } = useSearchPairs(localQuery)

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(localQuery), 300)
    return () => clearTimeout(t)
  }, [localQuery, setSearchQuery])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !focused) { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape') inputRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  function onSelect(pair: TokenPair) {
    setSelectedPair(pair)
    setPageView('discover')
    setLocalQuery('')
    setFocused(false)
  }

  return (
    <header className="h-11 bg-ax-nav border-b border-ax-border flex items-center px-3 gap-0 shrink-0 z-50 select-none">
      {/* Logo */}
      <div className="flex items-center gap-1.5 pr-4 border-r border-ax-border mr-3 shrink-0">
        <div className="w-6 h-6 bg-green-DEFAULT rounded-md flex items-center justify-center">
          <span className="text-ax-base font-black text-xs">A</span>
        </div>
        <span className="font-bold text-text-primary text-sm">AXIOM</span>
        <span className="badge badge-green ml-0.5">Pro</span>
      </div>

      {/* Nav */}
      <nav className="hidden md:flex items-center gap-0.5">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setPageView(item.id)}
            className={clsx('nav-tab flex items-center gap-1', pageView === item.id && 'active')}
          >
            {item.label}
            {item.badge && <span className="badge badge-green">{item.badge}</span>}
          </button>
        ))}
      </nav>

      {/* Search */}
      <div className="flex-1 max-w-xs mx-3 relative">
        <div className={clsx(
          'flex items-center gap-2 ax-input px-3 h-7 rounded-lg transition-colors',
          focused ? 'border-green-DEFAULT/40' : ''
        )}>
          <Search size={12} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search by token or CA..."
            className="flex-1 bg-transparent text-text-primary text-xs outline-none placeholder-text-muted min-w-0"
          />
          {localQuery
            ? <button onClick={() => setLocalQuery('')} className="text-text-muted hover:text-text-primary shrink-0"><X size={10} /></button>
            : <kbd className="text-2xs text-text-muted bg-ax-border px-1 rounded shrink-0">/</kbd>
          }
        </div>

        {focused && localQuery.length >= 2 && results && results.length > 0 && (
          <div className="absolute top-8 left-0 right-0 bg-ax-panel border border-ax-border rounded-xl shadow-dropdown z-[100] max-h-72 overflow-y-auto animate-slide-in">
            <div className="px-3 py-1.5 text-2xs text-text-muted border-b border-ax-border">{results.length} results</div>
            {results.slice(0, 8).map(pair => (
              <SearchRow key={pair.pairAddress} pair={pair} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {/* SOL selector */}
        <button className="flex items-center gap-1 bg-ax-card border border-ax-border rounded-lg px-2.5 h-7 text-xs font-medium text-text-primary hover:bg-ax-hover transition-colors">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-blue-500" />
          SOL
          <ChevronDown size={10} className="text-text-muted" />
        </button>

        {/* Deposit */}
        <button className="btn-buy h-7 flex items-center gap-1 px-3">
          <Download size={10} />
          Deposit
        </button>

        <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors">
          <Star size={12} />
        </button>
        <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors relative">
          <Bell size={12} />
        </button>
        <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors">
          <Settings size={12} />
        </button>

        <WalletMultiButton />

        {connected && (
          <button className="w-7 h-7 flex items-center justify-center bg-ax-card border border-ax-border rounded-lg overflow-hidden hover:border-green-DEFAULT/40 transition-colors">
            <User size={12} className="text-green-DEFAULT" />
          </button>
        )}
      </div>
    </header>
  )
}

function SearchRow({ pair, onSelect }: { pair: TokenPair; onSelect: (p: TokenPair) => void }) {
  const [imgErr, setImgErr] = useState(false)
  const c = pair.priceChange?.h24 ?? 0
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-ax-hover transition-colors text-left border-b border-ax-border/50 last:border-0"
      onClick={() => onSelect(pair)}
    >
      {pair.info?.imageUrl && !imgErr
        ? <img src={pair.info.imageUrl} alt="" width={24} height={24} className="rounded-full object-cover shrink-0" onError={() => setImgErr(true)} />
        : <div className="w-6 h-6 rounded-full bg-ax-card flex items-center justify-center text-2xs font-bold text-text-primary shrink-0">{pair.baseToken.symbol[0]}</div>
      }
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-text-primary">{pair.baseToken.symbol}</span>
        <span className="text-2xs text-text-muted ml-1.5 truncate">{pair.baseToken.name}</span>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-mono text-text-primary">{pair.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(6)}` : '—'}</div>
        <div className={clsx('text-2xs font-mono', c >= 0 ? 'pos' : 'neg')}>{formatPercent(c)}</div>
      </div>
    </button>
  )
}
