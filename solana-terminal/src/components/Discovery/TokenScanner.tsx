import { useState, useMemo, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import {
  RefreshCw, SlidersHorizontal, Filter, Eye, Twitter, Globe,
  MessageCircle, Copy, ExternalLink, Zap, ChevronDown, ChevronUp, BookmarkPlus, Search
} from 'lucide-react'
import { useTrendingPairs, useNewPairs } from '../../hooks/useTokenPairs'
import { useTerminalStore } from '../../store/terminalStore'
import { formatAge, formatNumber, formatPercent } from '../../services/dexscreener'
import { getQuote, getSwapTransaction, SOL_MINT } from '../../services/jupiter'
import { Sparkline } from './Sparkline'
import type { TokenPair, SortField } from '../../types'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// Deterministic mock values based on address
function mockHolderStats(addr: string) {
  const s = addr.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return {
    top10:    5 + (s % 38),         // 5–42%
    dev:      (s % 12),              // 0–11%
    bundled:  (s % 16),              // 0–15%
    snipers:  (s % 8),               // 0–7%
    holders:  50 + (s % 2000),       // 50–2050
    paid:     s % 3 !== 0,           // ~66% paid
  }
}

type ScanTab = 'top' | 'trending' | 'surge' | 'new' | 'pump'
type TimeFrame = '1m' | '5m' | '30m' | '1h'
type SortDir = 'asc' | 'desc'

export function TokenScanner() {
  const { setSelectedPair, selectedPair, watchlist, toggleWatchlist, quickBuyPreset, activePreset } = useTerminalStore()
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()

  const [scanTab, setScanTab] = useState<ScanTab>('trending')
  const [tf, setTf] = useState<TimeFrame>('5m')
  const [sortField, setSortField] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [minMcap, setMinMcap] = useState(0)
  const [maxMcap, setMaxMcap] = useState(0)
  const [minLiq, setMinLiq] = useState(0)
  const [minVol, setMinVol] = useState(0)
  const [quickBuying, setQuickBuying] = useState<string | null>(null)

  const { data: trending, isLoading: tLoad, refetch: tRefetch, isFetching: tFetch } = useTrendingPairs()
  const { data: newPairs, isLoading: nLoad, refetch: nRefetch, isFetching: nFetch } = useNewPairs()

  const rawPairs = useMemo(() => {
    const base = scanTab === 'new' || scanTab === 'pump' ? newPairs : trending
    return (base ?? []).filter(p => {
      const liq = p.liquidity?.usd ?? 0
      const vol = p.volume?.h24 ?? 0
      const mc  = p.marketCap ?? p.fdv ?? 0
      return liq >= minLiq && vol >= minVol
        && (minMcap === 0 || mc >= minMcap)
        && (maxMcap === 0 || mc <= maxMcap)
    })
  }, [scanTab, trending, newPairs, minLiq, minVol, minMcap, maxMcap])

  const pairs = useMemo(() => {
    return [...rawPairs].sort((a, b) => {
      let va = 0, vb = 0
      switch (sortField) {
        case 'marketCap': va = a.marketCap ?? a.fdv ?? 0; vb = b.marketCap ?? b.fdv ?? 0; break
        case 'liquidity': va = a.liquidity?.usd ?? 0; vb = b.liquidity?.usd ?? 0; break
        case 'volume':    va = a.volume?.h24 ?? 0; vb = b.volume?.h24 ?? 0; break
        case 'change5m':  va = a.priceChange?.m5 ?? 0; vb = b.priceChange?.m5 ?? 0; break
        case 'change1h':  va = a.priceChange?.h1 ?? 0; vb = b.priceChange?.h1 ?? 0; break
        case 'age':       va = a.pairCreatedAt ?? 0; vb = b.pairCreatedAt ?? 0; break
      }
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [rawPairs, sortField, sortDir])

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortField(f); setSortDir('desc') }
  }

  const SortIcon = ({ f }: { f: SortField }) => sortField !== f
    ? <ChevronDown size={9} className="text-text-muted" />
    : sortDir === 'desc'
    ? <ChevronDown size={9} className="text-green-DEFAULT" />
    : <ChevronUp size={9} className="text-green-DEFAULT" />

  const isLoading = scanTab === 'new' || scanTab === 'pump' ? nLoad : tLoad
  const isFetching = scanTab === 'new' || scanTab === 'pump' ? nFetch : tFetch
  const refetch = scanTab === 'new' || scanTab === 'pump' ? nRefetch : tRefetch

  const quickBuy = useCallback(async (pair: TokenPair, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!publicKey || !signTransaction) { toast.error('Connect wallet first'); return }
    if (!quickBuyPreset || quickBuyPreset <= 0) { toast.error('Set Quick Buy amount in bottom bar'); return }
    setQuickBuying(pair.pairAddress)
    try {
      const amount = Math.floor(quickBuyPreset * 1e9)
      const q = await getQuote(SOL_MINT, pair.baseToken.address, amount.toString(), 100)
      if (!q) throw new Error('No quote')
      const swapTx = await getSwapTransaction(q, publicKey.toBase58())
      if (!swapTx) throw new Error('No tx')
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTx, 'base64'))
      const signed = await signTransaction(tx)
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
      toast.success(`⚡ Bought ${pair.baseToken.symbol}! TX: ${sig.slice(0, 8)}...`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message.slice(0, 60) : 'Quick buy failed')
    } finally {
      setQuickBuying(null)
    }
  }, [publicKey, signTransaction, connection, quickBuyPreset])

  const SCAN_TABS: { id: ScanTab; label: string }[] = [
    { id: 'top',      label: 'Top' },
    { id: 'trending', label: 'Trending' },
    { id: 'surge',    label: 'Surge' },
    { id: 'new',      label: 'DEX Screener' },
    { id: 'pump',     label: 'Pump Live' },
  ]

  const TF_TABS: TimeFrame[] = ['1m', '5m', '30m', '1h']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top tabs row */}
      <div className="flex items-center border-b border-ax-border px-3 shrink-0 bg-ax-nav/50">
        {SCAN_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setScanTab(tab.id)}
            className={clsx('scan-tab', scanTab === tab.id && 'active')}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-4 border-l border-ax-border pl-3">
          {TF_TABS.map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={clsx(
                'text-2xs font-mono px-2 py-0.5 rounded transition-colors',
                tf === t ? 'bg-ax-card text-text-primary border border-ax-bordl' : 'text-text-muted hover:text-text-primary'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx('flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors',
              showFilters ? 'bg-green-dim border-green-DEFAULT text-green-DEFAULT' : 'bg-ax-card border-ax-border text-text-muted hover:text-text-primary')}
          >
            <Filter size={11} /><span>Filter</span>
          </button>
          <span className="text-2xs text-text-muted px-2 border border-ax-border rounded-lg py-1">
            {pairs.length} pairs
          </span>
          <button
            onClick={() => refetch()}
            className={clsx('w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors', isFetching && 'animate-spin')}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-ax-border bg-ax-sidebar animate-slide-in flex-wrap">
          <FilterInput label="Min MCap" value={minMcap} onChange={setMinMcap} />
          <FilterInput label="Max MCap" value={maxMcap} onChange={setMaxMcap} />
          <FilterInput label="Min Liq" value={minLiq} onChange={setMinLiq} />
          <FilterInput label="Min Vol" value={minVol} onChange={setMinVol} />
          <button
            onClick={() => { setMinMcap(0); setMaxMcap(0); setMinLiq(0); setMinVol(0) }}
            className="text-2xs text-red-DEFAULT hover:underline ml-auto"
          >
            Reset
          </button>
        </div>
      )}

      {/* Column headers */}
      <div className="grid gap-0 border-b border-ax-border bg-ax-nav/30 text-2xs text-text-muted font-medium shrink-0"
        style={{ gridTemplateColumns: '2fr 90px 80px 80px 70px 80px 130px 90px' }}>
        <div className="px-3 py-2">Pair Info</div>
        <button onClick={() => toggleSort('marketCap')} className="px-2 py-2 text-right flex items-center justify-end gap-1 hover:text-text-primary"><SortIcon f="marketCap" />Market Cap</button>
        <button onClick={() => toggleSort('liquidity')} className="px-2 py-2 text-right flex items-center justify-end gap-1 hover:text-text-primary"><SortIcon f="liquidity" />Liquidity</button>
        <button onClick={() => toggleSort('volume')}    className="px-2 py-2 text-right flex items-center justify-end gap-1 hover:text-text-primary"><SortIcon f="volume" />Volume</button>
        <div className="px-2 py-2 text-right">TXNS</div>
        <div className="px-2 py-2 text-center">Chart</div>
        <div className="px-2 py-2 text-center">Token Info</div>
        <div className="px-2 py-2 text-center">Action</div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-1">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-ax-card animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
            <Search size={24} className="opacity-30" />
            <div className="text-xs">No tokens found. Try adjusting filters.</div>
          </div>
        ) : (
          pairs.map((pair, idx) => (
            <TokenRow
              key={pair.pairAddress}
              pair={pair}
              idx={idx}
              selected={selectedPair?.pairAddress === pair.pairAddress}
              watched={watchlist.includes(pair.pairAddress)}
              onSelect={setSelectedPair}
              onWatch={toggleWatchlist}
              onQuickBuy={quickBuy}
              isQuickBuying={quickBuying === pair.pairAddress}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TokenRow({ pair, idx, selected, watched, onSelect, onWatch, onQuickBuy, isQuickBuying }: {
  pair: TokenPair; idx: number; selected: boolean; watched: boolean
  onSelect: (p: TokenPair) => void; onWatch: (a: string) => void
  onQuickBuy: (p: TokenPair, e: React.MouseEvent) => void; isQuickBuying: boolean
}) {
  const [imgErr, setImgErr] = useState(false)
  const [copied, setCopied] = useState(false)
  const stats = useMemo(() => mockHolderStats(pair.baseToken.address), [pair.baseToken.address])

  const c = pair.priceChange?.h24 ?? 0
  const mc = pair.marketCap ?? pair.fdv ?? 0
  const buys = pair.txns?.h24?.buys ?? 0
  const sells = pair.txns?.h24?.sells ?? 0
  const socials = pair.info?.socials ?? []
  const websites = pair.info?.websites ?? []
  const twitter = socials.find(s => s.type === 'twitter')
  const telegram = socials.find(s => s.type === 'telegram')

  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(pair.baseToken.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      onClick={() => onSelect(pair)}
      className={clsx(
        'token-row grid border-b border-ax-border/60 items-center',
        selected && 'selected',
        idx % 2 === 1 && 'bg-white/[0.01]'
      )}
      style={{ gridTemplateColumns: '2fr 90px 80px 80px 70px 80px 130px 90px' }}
    >
      {/* Pair Info */}
      <div className="flex items-center gap-2 px-3 py-2 min-w-0">
        <div className="relative shrink-0">
          {pair.info?.imageUrl && !imgErr
            ? <img src={pair.info.imageUrl} alt="" width={32} height={32} className="rounded-full object-cover" onError={() => setImgErr(true)} />
            : <div className="w-8 h-8 rounded-full bg-ax-card border border-ax-border flex items-center justify-center text-xs font-bold text-text-primary">
                {pair.baseToken.symbol[0]}
              </div>
          }
          {/* Pair age indicator dot */}
          {pair.pairCreatedAt && Date.now() - pair.pairCreatedAt < 3600000 && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-DEFAULT rounded-full border-2 border-ax-base" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-text-primary">{pair.baseToken.symbol}</span>
            <span className="text-2xs text-text-muted truncate max-w-[80px]">{pair.baseToken.name}</span>
            <button onClick={copy} className="text-text-muted hover:text-text-primary" title="Copy CA">
              <Copy size={9} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-2xs text-text-muted font-mono">{formatAge(pair.pairCreatedAt)}</span>
            <span className="text-2xs text-text-muted">{pair.dexId}</span>
            {/* Social links */}
            {twitter && <a href={twitter.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-text-muted hover:text-blue-400"><Twitter size={9} /></a>}
            {telegram && <a href={telegram.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-text-muted hover:text-blue-400"><MessageCircle size={9} /></a>}
            {websites[0] && <a href={websites[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-text-muted hover:text-text-primary"><Globe size={9} /></a>}
            <a href={`https://dexscreener.com/solana/${pair.pairAddress}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-text-muted hover:text-text-primary"><ExternalLink size={9} /></a>
            {/* View count */}
            <span className="flex items-center gap-0.5 text-2xs text-text-muted">
              <Eye size={8} />
              {Math.floor(10 + (pair.baseToken.address.charCodeAt(0) % 500))}
            </span>
          </div>
        </div>
      </div>

      {/* Market Cap */}
      <div className="px-2 py-2 text-right">
        <div className="text-xs font-mono text-text-primary">{formatNumber(mc)}</div>
        <div className={clsx('text-2xs font-mono', c >= 0 ? 'pos' : 'neg')}>{formatPercent(c)}</div>
      </div>

      {/* Liquidity */}
      <div className="px-2 py-2 text-right">
        <div className="text-xs font-mono text-text-primary">{formatNumber(pair.liquidity?.usd)}</div>
      </div>

      {/* Volume */}
      <div className="px-2 py-2 text-right">
        <div className="text-xs font-mono text-text-primary">{formatNumber(pair.volume?.h24)}</div>
        <div className={clsx('text-2xs font-mono', (pair.priceChange?.h1 ?? 0) >= 0 ? 'pos' : 'neg')}>
          {formatPercent(pair.priceChange?.h1 ?? 0)}
        </div>
      </div>

      {/* TXNS */}
      <div className="px-2 py-2 text-right">
        <div className="text-xs font-mono text-text-primary">{buys + sells}</div>
        <div className="text-2xs">
          <span className="pos">{buys}</span>
          <span className="neu mx-0.5">/</span>
          <span className="neg">{sells}</span>
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-2 py-2 flex items-center justify-center">
        <Sparkline pair={pair} width={76} height={26} />
      </div>

      {/* Token Info (Axiom-style columns) */}
      <div className="px-2 py-2">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-2xs">
          <div className="flex items-center gap-1">
            <span className="text-text-muted">T10</span>
            <span className={clsx('font-mono', stats.top10 > 30 ? 'neg' : stats.top10 > 20 ? 'text-yellow-DEFAULT' : 'pos')}>
              {stats.top10}%
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-text-muted">Dev</span>
            <span className={clsx('font-mono', stats.dev > 5 ? 'neg' : 'pos')}>{stats.dev}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-text-muted">Bndl</span>
            <span className={clsx('font-mono', stats.bundled > 10 ? 'text-yellow-DEFAULT' : 'pos')}>{stats.bundled}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-text-muted">Snip</span>
            <span className={clsx('font-mono', stats.snipers > 5 ? 'neg' : 'pos')}>{stats.snipers}%</span>
          </div>
          <div className="flex items-center gap-1 col-span-2">
            <span className="text-text-muted">Holders</span>
            <span className="font-mono text-text-secondary">{stats.holders.toLocaleString()}</span>
            {stats.paid
              ? <span className="badge badge-green ml-auto">Paid</span>
              : <span className="badge badge-gray ml-auto">Unpaid</span>
            }
          </div>
        </div>
      </div>

      {/* Action */}
      <div className="px-2 py-2 flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
        <button
          onClick={(e) => onQuickBuy(pair, e)}
          disabled={isQuickBuying}
          className={clsx('btn-buy flex items-center gap-1', isQuickBuying && 'opacity-60 cursor-not-allowed')}
        >
          {isQuickBuying ? <RefreshCw size={10} className="animate-spin" /> : <Zap size={10} />}
          Buy
        </button>
        <button
          onClick={e => { e.stopPropagation(); onWatch(pair.pairAddress) }}
          className={clsx('w-6 h-6 flex items-center justify-center rounded transition-colors', watched ? 'text-green-DEFAULT' : 'text-text-muted hover:text-text-primary')}
        >
          <BookmarkPlus size={12} />
        </button>
      </div>
    </div>
  )
}

function FilterInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs text-text-muted whitespace-nowrap">{label}:</span>
      <input
        type="number"
        value={value || ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        placeholder="Any"
        className="ax-input w-20 px-2 py-0.5 text-2xs rounded"
      />
    </div>
  )
}
