import { useState, useRef, useEffect } from 'react'
import { Search, Bell, Star, ChevronDown, X, Download, Settings, User, Gift } from 'lucide-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useTerminalStore } from '../../store/terminalStore'
import { useSearchPairs } from '../../hooks/useTokenPairs'
import { formatPercent } from '../../services/dexscreener'
import type { TokenPair } from '../../types'
import type { PageView } from '../../store/terminalStore'
import clsx from 'clsx'

const NAV_ITEMS: { id: PageView; label: string; badge?: string; hot?: boolean }[] = [
  { id: 'discover',   label: 'Discover' },
  { id: 'pulse',      label: 'Pulse' },
  { id: 'copytrade',  label: 'CopyTrade', badge: 'NEW' },
  { id: 'trackers',   label: 'Trackers' },
  { id: 'perpetuals', label: 'Perpetuals' },
  { id: 'yield',      label: 'Yield' },
  { id: 'vision',     label: 'Vision', hot: true },
  { id: 'portfolio',  label: 'Portfolio' },
  { id: 'rewards',    label: 'Rewards' },
]

// flipit.gg SVG Logo
function FlipitLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="26" height="26" rx="6" fill="#16c784"/>
      {/* Stylized "F" with flip arrow */}
      <path d="M7 7h8v2.5H9.5v2.5h5v2.5h-5V19H7V7z" fill="#080a0e"/>
      {/* Flip arrow element */}
      <path d="M17 10.5 L20 7 L20 9.5 C20 14 17 16 14 17" stroke="#080a0e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M18.5 8.5 L20 7 L20.5 9" stroke="#080a0e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

export function TopNav() {
  const { pageView, setPageView, setSelectedPair, setSearchQuery } = useTerminalStore()
  const { connected } = useWallet()
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
      <div className="flex items-center gap-2 pr-4 border-r border-ax-border mr-3 shrink-0 cursor-pointer" onClick={() => setPageView('discover')}>
        <FlipitLogo />
        <div className="flex flex-col leading-none">
          <span className="font-black text-text-primary text-sm tracking-tight">flipit</span>
          <span className="text-2xs text-green-DEFAULT font-bold tracking-widest">.gg</span>
        </div>
        <span className="badge badge-green ml-0.5 text-[9px] px-1 py-0.5">Pro</span>
      </div>

      {/* Nav */}
      <nav className="hidden md:flex items-center gap-0.5">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setPageView(item.id)}
            className={clsx('nav-tab flex items-center gap-1 relative', pageView === item.id && 'active')}
          >
            {item.id === 'rewards' && <Gift size={10} />}
            {item.label}
            {item.badge && <span className="badge badge-green">{item.badge}</span>}
            {item.hot && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            )}
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
        {/* Wallet balance chips */}
        <div className="hidden lg:flex items-center gap-1 bg-ax-card border border-ax-border rounded-lg px-2 h-7 text-2xs font-mono text-text-muted">
          <span className="text-text-secondary">◎</span>
          <span>0</span>
          <span className="text-ax-bordl">|</span>
          <span className="text-text-secondary">🪙</span>
          <span>0</span>
        </div>

        {/* SOL selector */}
        <button className="flex items-center gap-1 bg-ax-card border border-ax-border rounded-lg px-2.5 h-7 text-xs font-medium text-text-primary hover:bg-ax-hover transition-colors">
          <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-purple-DEFAULT to-blue-accent" />
          SOL
          <ChevronDown size={10} className="text-text-muted" />
        </button>

        {/* Deposit */}
        <button className="btn-buy h-7 flex items-center gap-1 px-3 text-xs">
          <Download size={10} />
          Deposit
        </button>

        <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors">
          <Star size={12} />
        </button>
        <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors relative">
          <Bell size={12} />
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-DEFAULT" />
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
