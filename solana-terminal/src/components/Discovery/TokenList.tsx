import { useMemo, useState } from 'react'
import { TrendingUp, Clock, Star, RefreshCw, Filter, ChevronUp, ChevronDown } from 'lucide-react'
import { useTrendingPairs, useNewPairs } from '../../hooks/useTokenPairs'
import { useTerminalStore } from '../../store/terminalStore'
import { formatAge, formatNumber, formatPercent } from '../../services/dexscreener'
import type { TokenPair, SortField } from '../../types'
import clsx from 'clsx'

function TokenAvatar({ pair }: { pair: TokenPair }) {
  const [err, setErr] = useState(false)
  const img = pair.info?.imageUrl
  const sym = pair.baseToken?.symbol ?? '?'
  if (!img || err) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-purple/30 to-accent-blue/30 flex items-center justify-center text-text-primary text-xs font-bold shrink-0">
        {sym[0]}
      </div>
    )
  }
  return (
    <img
      src={img}
      alt={sym}
      width={32}
      height={32}
      className="w-8 h-8 rounded-full object-cover shrink-0"
      onError={() => setErr(true)}
    />
  )
}

type SortDir = 'asc' | 'desc'

export function TokenList() {
  const { activeTab, setActiveTab, watchlist, toggleWatchlist, setSelectedPair, selectedPair, minLiquidity, minVolume } = useTerminalStore()
  const { data: trending, isLoading: tLoad, refetch: tRefetch, isFetching: tFetching } = useTrendingPairs()
  const { data: newPairs, isLoading: nLoad, refetch: nRefetch, isFetching: nFetching } = useNewPairs()

  const [sortField, setSortField] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showFilters, setShowFilters] = useState(false)

  const rawPairs = activeTab === 'trending' ? trending : activeTab === 'new' ? newPairs : activeTab === 'watchlist'
    ? (trending ?? []).filter(p => watchlist.includes(p.pairAddress))
    : []

  const pairs = useMemo(() => {
    if (!rawPairs) return []
    const filtered = rawPairs.filter(p => {
      const liq = p.liquidity?.usd ?? 0
      const vol = p.volume?.h24 ?? 0
      return liq >= minLiquidity && vol >= minVolume
    })

    return [...filtered].sort((a, b) => {
      let va = 0, vb = 0
      switch (sortField) {
        case 'price': va = parseFloat(a.priceUsd ?? '0'); vb = parseFloat(b.priceUsd ?? '0'); break
        case 'change5m': va = a.priceChange?.m5 ?? 0; vb = b.priceChange?.m5 ?? 0; break
        case 'change1h': va = a.priceChange?.h1 ?? 0; vb = b.priceChange?.h1 ?? 0; break
        case 'change24h': va = a.priceChange?.h24 ?? 0; vb = b.priceChange?.h24 ?? 0; break
        case 'volume': va = a.volume?.h24 ?? 0; vb = b.volume?.h24 ?? 0; break
        case 'marketCap': va = a.marketCap ?? a.fdv ?? 0; vb = b.marketCap ?? b.fdv ?? 0; break
        case 'liquidity': va = a.liquidity?.usd ?? 0; vb = b.liquidity?.usd ?? 0; break
        case 'age': va = a.pairCreatedAt ?? 0; vb = b.pairCreatedAt ?? 0; break
      }
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [rawPairs, sortField, sortDir, minLiquidity, minVolume])

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortField(field); setSortDir('desc') }
  }

  const isLoading = activeTab === 'trending' ? tLoad : nLoad
  const isFetching = activeTab === 'trending' ? tFetching : nFetching
  const refetch = activeTab === 'trending' ? tRefetch : nRefetch

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown size={10} className="text-text-muted" />
    return sortDir === 'desc' ? <ChevronDown size={10} className="text-accent-blue" /> : <ChevronUp size={10} className="text-accent-blue" />
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-r border-border w-full lg:w-72 xl:w-80 shrink-0">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {([
          { id: 'trending', label: 'Trending', icon: TrendingUp },
          { id: 'new', label: 'New', icon: Clock },
          { id: 'watchlist', label: 'Watch', icon: Star },
        ] as const).map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-3 border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'text-accent-blue border-accent-blue'
                  : 'text-text-secondary border-transparent hover:text-text-primary'
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-xs text-text-muted flex-1">
          {pairs.length} tokens
        </span>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'w-6 h-6 rounded flex items-center justify-center transition-colors',
            showFilters ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary'
          )}
        >
          <Filter size={12} />
        </button>
        <button
          onClick={() => refetch()}
          className={clsx('w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-text-primary transition-colors', isFetching && 'animate-spin')}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary space-y-2 animate-slide-in">
          <FilterRow label="Min Liquidity" value={minLiquidity} onChange={useTerminalStore.getState().setMinLiquidity} presets={[1000, 5000, 25000, 100000]} prefix="$" />
          <FilterRow label="Min Volume 24h" value={minVolume} onChange={useTerminalStore.getState().setMinVolume} presets={[5000, 10000, 50000, 250000]} prefix="$" />
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center px-3 py-1.5 border-b border-border text-xs text-text-muted">
        <div className="w-8 shrink-0" />
        <div className="flex-1 min-w-0">Token</div>
        <button onClick={() => handleSort('change5m')} className="flex items-center gap-0.5 w-12 justify-end hover:text-text-primary">
          5m <SortIcon field="change5m" />
        </button>
        <button onClick={() => handleSort('change1h')} className="flex items-center gap-0.5 w-12 justify-end hover:text-text-primary">
          1h <SortIcon field="change1h" />
        </button>
        <button onClick={() => handleSort('volume')} className="flex items-center gap-0.5 w-16 justify-end hover:text-text-primary">
          Vol <SortIcon field="volume" />
        </button>
      </div>

      {/* Token rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-12 bg-bg-tertiary rounded-lg animate-pulse" />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted text-sm">
            {activeTab === 'watchlist' ? 'No tokens in watchlist' : 'No tokens found'}
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
    </div>
  )
}

function TokenRow({
  pair, selected, watched, onSelect, onWatch,
}: {
  pair: TokenPair
  selected: boolean
  watched: boolean
  onSelect: (p: TokenPair) => void
  onWatch: (addr: string) => void
}) {
  const c5m = pair.priceChange?.m5 ?? 0
  const c1h = pair.priceChange?.h1 ?? 0
  const vol = pair.volume?.h24

  return (
    <div
      className={clsx(
        'flex items-center px-3 py-2 cursor-pointer transition-colors token-row gap-2 border-b border-border/50',
        selected ? 'bg-accent-blue/8 border-l-2 border-l-accent-blue' : ''
      )}
      onClick={() => onSelect(pair)}
    >
      <TokenAvatar pair={pair} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-text-primary truncate">{pair.baseToken.symbol}</span>
          <button
            onClick={e => { e.stopPropagation(); onWatch(pair.pairAddress) }}
            className={clsx('shrink-0', watched ? 'text-accent-yellow' : 'text-text-muted hover:text-accent-yellow')}
          >
            <Star size={10} fill={watched ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="text-xs text-text-muted truncate">{formatAge(pair.pairCreatedAt)} • {pair.dexId}</div>
      </div>
      <div className={clsx('text-xs font-mono w-12 text-right', c5m >= 0 ? 'text-accent-green' : 'text-accent-red')}>
        {formatPercent(c5m)}
      </div>
      <div className={clsx('text-xs font-mono w-12 text-right', c1h >= 0 ? 'text-accent-green' : 'text-accent-red')}>
        {formatPercent(c1h)}
      </div>
      <div className="text-xs font-mono w-16 text-right text-text-secondary">
        {formatNumber(vol, 1)}
      </div>
    </div>
  )
}

function FilterRow({
  label, value, onChange, presets, prefix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  presets: number[]
  prefix?: string
}) {
  return (
    <div>
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="flex gap-1">
        {presets.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={clsx(
              'flex-1 text-xs py-0.5 rounded border transition-colors',
              value === p
                ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                : 'border-border text-text-muted hover:border-border-light'
            )}
          >
            {prefix}{p >= 1000 ? `${p / 1000}K` : p}
          </button>
        ))}
      </div>
    </div>
  )
}
