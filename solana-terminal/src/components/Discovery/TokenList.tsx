import { useMemo, useState } from 'react'
import { Star, RefreshCw, SlidersHorizontal, Flame, Zap } from 'lucide-react'
import { useTrendingPairs, useNewPairs } from '../../hooks/useTokenPairs'
import { useTerminalStore } from '../../store/terminalStore'
import { formatAge, formatNumber } from '../../services/dexscreener'
import type { TokenPair, SortField } from '../../types'
import clsx from 'clsx'

function Avatar({ pair, size = 30 }: { pair: TokenPair; size?: number }) {
  const [err, setErr] = useState(false)
  const img = pair.info?.imageUrl
  const sym = pair.baseToken?.symbol ?? '?'
  const colors = ['from-blue-accent/30 to-purple-DEFAULT/30', 'from-purple-DEFAULT/30 to-yellow-DEFAULT/30', 'from-green-DEFAULT/30 to-blue-accent/30']
  const colorIdx = sym.charCodeAt(0) % colors.length
  if (!img || err) {
    return (
      <div style={{ width: size, height: size, fontSize: size * 0.38 }}
        className={clsx('rounded-full bg-gradient-to-br flex items-center justify-center text-text-primary font-bold shrink-0', colors[colorIdx])}>
        {sym[0]}
      </div>
    )
  }
  return (
    <img src={img} alt={sym} style={{ width: size, height: size }}
      className="rounded-full object-cover shrink-0" onError={() => setErr(true)} />
  )
}

type SortDir = 'asc' | 'desc'

const FILTER_PRESETS = [
  { label: 'All', minLiq: 0, minVol: 0 },
  { label: '> $5K Liq', minLiq: 5000, minVol: 0 },
  { label: '> $50K Vol', minLiq: 0, minVol: 50000 },
  { label: 'Degen', minLiq: 1000, minVol: 1000 },
]

export function TokenList() {
  const {
    mainTab, setMainTab,
    watchlist, toggleWatchlist,
    setSelectedPair, selectedPair,
    minLiquidity, setMinLiquidity,
    minVolume, setMinVolume,
  } = useTerminalStore()

  const { data: trending, isLoading: tLoad, refetch: tRefetch, isFetching: tFetch } = useTrendingPairs()
  const { data: newPairs, isLoading: nLoad, refetch: nRefetch, isFetching: nFetch } = useNewPairs()

  const [sortField, setSortField] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [activePreset, setActivePreset] = useState(1)

  const rawPairs =
    mainTab === 'trending' ? trending :
    mainTab === 'new' ? newPairs :
    mainTab === 'watchlist' ? (trending ?? []).filter(p => watchlist.includes(p.pairAddress)) :
    []

  const pairs = useMemo(() => {
    if (!rawPairs) return []
    const filtered = rawPairs.filter(p =>
      (p.liquidity?.usd ?? 0) >= minLiquidity && (p.volume?.h24 ?? 0) >= minVolume
    )
    return [...filtered].sort((a, b) => {
      let va = 0, vb = 0
      switch (sortField) {
        case 'change5m':  va = a.priceChange?.m5 ?? 0; vb = b.priceChange?.m5 ?? 0; break
        case 'change1h':  va = a.priceChange?.h1 ?? 0; vb = b.priceChange?.h1 ?? 0; break
        case 'change24h': va = a.priceChange?.h24 ?? 0; vb = b.priceChange?.h24 ?? 0; break
        case 'volume':    va = a.volume?.h24 ?? 0; vb = b.volume?.h24 ?? 0; break
        case 'marketCap': va = a.marketCap ?? a.fdv ?? 0; vb = b.marketCap ?? b.fdv ?? 0; break
        case 'liquidity': va = a.liquidity?.usd ?? 0; vb = b.liquidity?.usd ?? 0; break
        case 'age':       va = a.pairCreatedAt ?? 0; vb = b.pairCreatedAt ?? 0; break
      }
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [rawPairs, sortField, sortDir, minLiquidity, minVolume])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortField(field); setSortDir('desc') }
  }

  const isLoading = mainTab === 'trending' ? tLoad : nLoad
  const isFetching = mainTab === 'trending' ? tFetch : nFetch
  const refetch = mainTab === 'trending' ? tRefetch : nRefetch

  function applyPreset(idx: number) {
    setActivePreset(idx)
    setMinLiquidity(FILTER_PRESETS[idx].minLiq)
    setMinVolume(FILTER_PRESETS[idx].minVol)
  }

  return (
    <div className="flex flex-col w-64 xl:w-72 shrink-0 bg-ax-base border-r border-ax-border overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-ax-border shrink-0">
        {([
          { id: 'trending', icon: Flame, label: 'Hot' },
          { id: 'new',      icon: Zap,   label: 'New' },
          { id: 'watchlist',icon: Star,  label: 'Watch' },
        ] as const).map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors border-b-2',
                mainTab === tab.id ? 'tab-active' : 'tab-inactive'
              )}
            >
              <Icon size={11} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Filter presets */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-ax-border">
        {FILTER_PRESETS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => applyPreset(i)}
            className={clsx(
              'text-xs px-1.5 py-0.5 rounded transition-colors whitespace-nowrap',
              activePreset === i
                ? 'bg-cyan/10 text-blue-accent border border-cyan/20'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx('ml-auto shrink-0 text-text-muted hover:text-text-primary transition-colors', showFilters && 'text-blue-accent')}
        >
          <SlidersHorizontal size={12} />
        </button>
        <button
          onClick={() => refetch()}
          className={clsx('text-text-muted hover:text-text-primary transition-colors', isFetching && 'animate-spin')}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {showFilters && (
        <div className="px-2 py-2 border-b border-ax-border bg-ax-sidebar space-y-2 animate-slide-in">
          <FilterSlider label="Min Liquidity" value={minLiquidity} onChange={setMinLiquidity} options={[0, 1000, 5000, 25000, 100000]} />
          <FilterSlider label="Min Vol 24h" value={minVolume} onChange={setMinVolume} options={[0, 1000, 10000, 50000, 250000]} />
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-[26px_1fr_44px_44px_52px] gap-0 px-2 py-1 border-b border-ax-border text-xs text-text-muted">
        <div />
        <div>Token</div>
        <button onClick={() => toggleSort('change5m')} className="text-right hover:text-text-primary flex items-center justify-end gap-0.5">
          5m{sortField === 'change5m' && <span className="text-blue-accent">{sortDir === 'desc' ? '↓' : '↑'}</span>}
        </button>
        <button onClick={() => toggleSort('change1h')} className="text-right hover:text-text-primary flex items-center justify-end gap-0.5">
          1h{sortField === 'change1h' && <span className="text-blue-accent">{sortDir === 'desc' ? '↓' : '↑'}</span>}
        </button>
        <button onClick={() => toggleSort('volume')} className="text-right hover:text-text-primary flex items-center justify-end gap-0.5">
          Vol{sortField === 'volume' && <span className="text-blue-accent">{sortDir === 'desc' ? '↓' : '↑'}</span>}
        </button>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-ax-card animate-pulse" />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-text-muted">
            {mainTab === 'watchlist' ? 'Star tokens to add to watchlist' : 'No tokens found'}
          </div>
        ) : (
          pairs.map(pair => (
            <TokenRow
              key={pair.pairAddress}
              pair={pair}
              selected={selectedPair?.pairAddress === pair.pairAddress}
              watched={watchlist.includes(pair.pairAddress)}
              onSelect={setSelectedPair}
              onWatch={toggleWatchlist}
            />
          ))
        )}
      </div>

      {/* Footer count */}
      <div className="px-3 py-1.5 border-t border-ax-border text-xs text-text-muted">
        {pairs.length} tokens
      </div>
    </div>
  )
}

function TokenRow({ pair, selected, onSelect }: {
  pair: TokenPair; selected: boolean; watched?: boolean
  onSelect: (p: TokenPair) => void; onWatch?: (a: string) => void
}) {
  const c5m = pair.priceChange?.m5 ?? 0
  const c1h = pair.priceChange?.h1 ?? 0
  const vol = pair.volume?.h24

  // Age badge
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity
  const isNew = ageMs < 1000 * 60 * 60 // < 1h
  const isHot = (pair.boosts?.active ?? 0) > 0

  return (
    <div
      onClick={() => onSelect(pair)}
      className={clsx('token-row grid grid-cols-[26px_1fr_44px_44px_52px] gap-0 items-center px-2 py-1.5 cursor-pointer border-b border-ax-border/40', selected && 'active')}
    >
      <div className="relative">
        <Avatar pair={pair} size={22} />
        {isNew && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-DEFAULT border border-bg-base" />}
      </div>

      <div className="min-w-0 px-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-text-primary truncate leading-none">{pair.baseToken.symbol}</span>
          {isHot && <Flame size={9} className="text-yellow-DEFAULT shrink-0" />}
        </div>
        <div className="text-xs text-text-muted leading-none mt-0.5 font-mono">{formatAge(pair.pairCreatedAt)}</div>
      </div>

      <div className={clsx('text-xs font-mono text-right', c5m >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
        {c5m >= 0 ? '+' : ''}{c5m.toFixed(1)}%
      </div>
      <div className={clsx('text-xs font-mono text-right', c1h >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
        {c1h >= 0 ? '+' : ''}{c1h.toFixed(1)}%
      </div>
      <div className="text-xs font-mono text-right text-text-secondary">
        {formatNumber(vol, 0).replace('$', '')}
      </div>
    </div>
  )
}

function FilterSlider({ label, value, onChange, options }: {
  label: string; value: number; onChange: (v: number) => void; options: number[]
}) {
  return (
    <div>
      <div className="text-xs text-text-muted mb-1">{label}: <span className="text-text-secondary">{value === 0 ? 'Any' : formatNumber(value, 0)}</span></div>
      <div className="flex gap-1">
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)}
            className={clsx('flex-1 text-xs py-0.5 rounded border transition-colors',
              value === o ? 'border-cyan/40 text-blue-accent bg-cyan/5' : 'border-ax-border text-text-muted hover:border-ax-border-light'
            )}>
            {o === 0 ? 'Any' : o >= 1000 ? `${o / 1000}K` : o}
          </button>
        ))}
      </div>
    </div>
  )
}
