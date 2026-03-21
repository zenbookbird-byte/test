import { useState, useRef, useEffect } from 'react'
import { Search, Bell, Settings, Zap, X } from 'lucide-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useTerminalStore } from '../../store/terminalStore'
import { useSearchPairs } from '../../hooks/useTokenPairs'
import type { TokenPair } from '../../types'
import { formatNumber, formatPercent } from '../../services/dexscreener'
import clsx from 'clsx'

export function Header() {
  const { searchQuery, setSearchQuery, setSelectedPair } = useTerminalStore()
  const [focused, setFocused] = useState(false)
  const [localQuery, setLocalQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: results } = useSearchPairs(localQuery)

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(localQuery), 300)
    return () => clearTimeout(timer)
  }, [localQuery, setSearchQuery])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') inputRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onSelect(pair: TokenPair) {
    setSelectedPair(pair)
    setLocalQuery('')
    setFocused(false)
    inputRef.current?.blur()
  }

  return (
    <header className="h-14 bg-bg-secondary border-b border-border flex items-center px-4 gap-4 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-purple to-accent-green flex items-center justify-center">
          <Zap size={14} className="text-white" />
        </div>
        <span className="font-bold text-text-primary text-sm tracking-wide hidden sm:block">
          SolTerminal
        </span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md relative" ref={dropdownRef}>
        <div className={clsx(
          'flex items-center gap-2 bg-bg-tertiary border rounded-lg px-3 h-9 transition-colors',
          focused ? 'border-accent-blue' : 'border-border hover:border-border-light'
        )}>
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search token or paste address... (⌘K)"
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder-text-muted"
          />
          {localQuery && (
            <button onClick={() => setLocalQuery('')} className="text-text-muted hover:text-text-primary">
              <X size={12} />
            </button>
          )}
          {!localQuery && (
            <kbd className="text-xs text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border hidden sm:block">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Dropdown */}
        {focused && localQuery.length >= 2 && results && results.length > 0 && (
          <div className="absolute top-11 left-0 right-0 bg-bg-card border border-border rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto animate-slide-in">
            {results.slice(0, 8).map(pair => (
              <SearchResult key={pair.pairAddress} pair={pair} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button className="w-8 h-8 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-border-light transition-colors">
          <Bell size={14} />
        </button>
        <button className="w-8 h-8 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-border-light transition-colors">
          <Settings size={14} />
        </button>
        <WalletMultiButton />
      </div>
    </header>
  )
}

function SearchResult({ pair, onSelect }: { pair: TokenPair; onSelect: (p: TokenPair) => void }) {
  const change = pair.priceChange?.h24 ?? 0
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors text-left"
      onClick={() => onSelect(pair)}
    >
      <TokenLogo pair={pair} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{pair.baseToken.symbol}</span>
          <span className="text-xs text-text-muted">{pair.dexId}</span>
        </div>
        <div className="text-xs text-text-secondary truncate">{pair.baseToken.name}</div>
      </div>
      <div className="text-right">
        <div className="text-sm font-mono text-text-primary">
          {pair.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(6)}` : '—'}
        </div>
        <div className={clsx('text-xs font-mono', change >= 0 ? 'text-accent-green' : 'text-accent-red')}>
          {formatPercent(change)}
        </div>
      </div>
    </button>
  )
}

export function TokenLogo({ pair, size = 32 }: { pair: TokenPair; size?: number }) {
  const [err, setErr] = useState(false)
  const img = pair.info?.imageUrl
  const sym = pair.baseToken?.symbol ?? '?'
  if (!img || err) {
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.38 }}
        className="rounded-full bg-gradient-to-br from-accent-purple/40 to-accent-blue/40 flex items-center justify-center text-text-primary font-bold"
      >
        {sym[0]}
      </div>
    )
  }
  return (
    <img
      src={img}
      alt={sym}
      width={size}
      height={size}
      className="rounded-full object-cover"
      onError={() => setErr(true)}
    />
  )
}
