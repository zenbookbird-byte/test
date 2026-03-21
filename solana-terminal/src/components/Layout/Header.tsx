import { useState, useRef, useEffect } from 'react'
import { Search, Bell, Settings, Zap, X, Flame, Shield, Activity } from 'lucide-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useTerminalStore } from '../../store/terminalStore'
import { useSearchPairs } from '../../hooks/useTokenPairs'
import type { TokenPair } from '../../types'
import { formatPercent } from '../../services/dexscreener'
import clsx from 'clsx'

export function Header() {
  const { setSearchQuery, setSelectedPair, infernoMode, toggleInferno, mevProtection, toggleMev } = useTerminalStore()
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape') inputRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onSelect(pair: TokenPair) {
    setSelectedPair(pair)
    setLocalQuery('')
    setFocused(false)
  }

  return (
    <header className="h-12 bg-bg-primary border-b border-border flex items-center px-3 gap-3 shrink-0 z-50">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0 mr-1">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan to-accent-purple flex items-center justify-center">
          <Zap size={12} className="text-white" />
        </div>
        <span className="font-bold text-text-primary text-sm tracking-wide hidden sm:block">
          Sol<span className="text-cyan-DEFAULT">Terminal</span>
        </span>
        <span className="text-xs text-text-muted border border-border px-1.5 py-0.5 rounded font-mono hidden md:block">v2</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-sm relative">
        <div className={clsx(
          'flex items-center gap-2 bg-bg-tertiary border rounded-lg px-2.5 h-8 transition-all',
          focused ? 'border-cyan-DEFAULT/50 bg-bg-card' : 'border-border hover:border-border-light'
        )}>
          <Search size={12} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Token name, symbol, or address... (⌘K)"
            className="flex-1 bg-transparent text-text-primary text-xs outline-none placeholder-text-muted"
          />
          {localQuery && (
            <button onClick={() => setLocalQuery('')} className="text-text-muted hover:text-text-primary">
              <X size={10} />
            </button>
          )}
        </div>

        {focused && localQuery.length >= 2 && results && results.length > 0 && (
          <div className="absolute top-9 left-0 right-0 bg-bg-card border border-border rounded-xl shadow-2xl z-50 max-h-72 overflow-y-auto animate-slide-in">
            <div className="px-3 py-1.5 border-b border-border text-xs text-text-muted">
              {results.length} results for "{localQuery}"
            </div>
            {results.slice(0, 8).map(pair => (
              <SearchResult key={pair.pairAddress} pair={pair} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      {/* Status indicators */}
      <div className="hidden lg:flex items-center gap-1.5 ml-1">
        <div className="flex items-center gap-1 text-xs text-accent-green bg-accent-green/10 border border-accent-green/20 px-2 py-1 rounded-md">
          <Activity size={10} />
          <span className="font-mono">Live</span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {/* MEV Protection */}
        <button
          onClick={toggleMev}
          title="MEV Protection"
          className={clsx(
            'flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium border transition-all',
            mevProtection
              ? 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple'
              : 'bg-bg-tertiary border-border text-text-muted hover:text-text-secondary'
          )}
        >
          <Shield size={11} />
          <span className="hidden md:block">MEV</span>
        </button>

        {/* Inferno Mode */}
        <button
          onClick={toggleInferno}
          title="Inferno Mode — one-click instant trades"
          className={clsx(
            'flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium border transition-all',
            infernoMode
              ? 'inferno-active border-orange-500/50 text-white'
              : 'bg-bg-tertiary border-border text-text-muted hover:text-orange-400'
          )}
        >
          <Flame size={11} />
          <span className="hidden md:block">Inferno</span>
        </button>

        <button className="w-7 h-7 rounded-md bg-bg-tertiary border border-border flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
          <Bell size={12} />
        </button>
        <button className="w-7 h-7 rounded-md bg-bg-tertiary border border-border flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
          <Settings size={12} />
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
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover transition-colors text-left border-b border-border/50 last:border-0"
      onClick={() => onSelect(pair)}
    >
      <TokenLogo pair={pair} size={26} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">{pair.baseToken.symbol}</span>
          <span className="text-xs text-text-muted">{pair.dexId}</span>
        </div>
        <div className="text-xs text-text-muted truncate">{pair.baseToken.name}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-mono text-text-primary">
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
        className="rounded-full bg-gradient-to-br from-accent-purple/40 to-cyan/20 flex items-center justify-center text-text-primary font-bold shrink-0"
      >
        {sym[0]}
      </div>
    )
  }
  return (
    <img src={img} alt={sym} width={size} height={size}
      className="rounded-full object-cover shrink-0"
      onError={() => setErr(true)}
      style={{ width: size, height: size }}
    />
  )
}
