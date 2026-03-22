import { useState, useMemo } from 'react'
import { Search, TrendingUp, Users, Star, Zap, Filter, ExternalLink, Copy, CheckCircle2 } from 'lucide-react'
import { TRADERS, AVATAR_COLORS, shortAddr, fmtUsd, type Trader, type TraderTag } from './traderData'
import { TraderProfile } from './TraderProfile'
import { CopyTradeModal } from './CopyTradeModal'
import clsx from 'clsx'

type SortKey = 'winRate' | 'pnl' | 'trades' | 'followers' | 'copyTraders'
type FilterTag = TraderTag | 'all'

const TAG_LABELS: Record<FilterTag, string> = {
  all: 'All Traders',
  smart: '🧠 Smart Money',
  whale: '🐳 Whale',
  degen: '🎲 Degen',
  kol: '📢 KOL',
  bot: '🤖 Bot',
}

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'winRate', label: 'Win Rate' },
  { id: 'pnl', label: '7D PnL' },
  { id: 'trades', label: 'Trades' },
  { id: 'followers', label: 'Followers' },
  { id: 'copyTraders', label: 'Copiers' },
]

function WinRateBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-ax-card rounded-full overflow-hidden">
        <div className="h-full bg-green-DEFAULT rounded-full" style={{ width: `${rate}%` }} />
      </div>
      <span className={clsx('text-xs font-bold font-mono', rate >= 80 ? 'text-green-DEFAULT' : rate >= 60 ? 'text-yellow-DEFAULT' : 'text-red-DEFAULT')}>
        {rate.toFixed(1)}%
      </span>
    </div>
  )
}

function TraderRow({ trader, rank, onSelect, onCopy }: {
  trader: Trader; rank: number
  onSelect: (t: Trader) => void
  onCopy: (t: Trader) => void
}) {
  const [copied, setCopied] = useState(false)

  function copyAddr(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(trader.address).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div onClick={() => onSelect(trader)}
      className="grid grid-cols-[32px_2fr_100px_120px_70px_80px_80px_100px] gap-2 items-center px-4 py-3 border-b border-ax-border/50 hover:bg-ax-hover transition-colors cursor-pointer group">
      {/* Rank */}
      <div className={clsx('text-xs font-bold text-center', rank <= 3 ? 'text-yellow-DEFAULT' : 'text-text-muted')}>
        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
      </div>

      {/* Trader */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={clsx('w-8 h-8 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-xs font-bold text-white', AVATAR_COLORS[trader.avatarSeed])}>
          {(trader.name ?? trader.address)[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {trader.name
              ? <span className="text-xs font-bold text-text-primary truncate">{trader.name}</span>
              : <span className="text-xs font-mono text-text-secondary">{shortAddr(trader.address)}</span>
            }
            <button onClick={copyAddr} className="text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100 shrink-0">
              {copied ? <CheckCircle2 size={10} className="text-green-DEFAULT" /> : <Copy size={10} />}
            </button>
            {trader.verified && <span className="text-blue-accent text-2xs shrink-0">✓</span>}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {trader.tags.map(tag => (
              <span key={tag} className={clsx('badge text-[9px] px-1 py-0',
                tag === 'smart' ? 'badge-green' :
                tag === 'whale' ? 'text-blue-accent bg-blue-accent/10 border border-blue-accent/20' :
                tag === 'kol' ? 'text-purple-DEFAULT bg-purple-DEFAULT/10 border border-purple-DEFAULT/20' :
                tag === 'bot' ? 'text-yellow-DEFAULT bg-yellow-DEFAULT/10 border border-yellow-DEFAULT/20' :
                'badge-red'
              )}>
                {tag.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Win Rate */}
      <WinRateBar rate={trader.winRate7d} />

      {/* 7D PnL */}
      <div>
        <div className="text-xs font-bold font-mono text-green-DEFAULT">+{trader.pnlPct7d.toFixed(1)}%</div>
        <div className="text-2xs text-green-DEFAULT/70 font-mono">+{fmtUsd(trader.pnlUsd7d)}</div>
      </div>

      {/* Trades */}
      <div className="text-xs font-mono text-text-primary text-right">{trader.totalTrades7d}</div>

      {/* Avg Duration */}
      <div className="text-xs text-text-muted text-right">{trader.avgDuration7d}</div>

      {/* Followers */}
      <div className="flex items-center gap-1 justify-end">
        <Users size={10} className="text-text-muted" />
        <span className="text-xs text-text-secondary">{trader.followers >= 1000 ? `${(trader.followers / 1000).toFixed(1)}K` : trader.followers}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
        <button onClick={() => onCopy(trader)} className="btn-buy px-2.5 py-1 text-2xs font-bold rounded-md flex items-center gap-1">
          <Zap size={9} />
          Copy
        </button>
        <a href={`https://solscan.io/account/${trader.address}`} target="_blank" rel="noopener noreferrer"
          className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded transition-colors">
          <ExternalLink size={9} />
        </a>
      </div>
    </div>
  )
}

export function CopyTradePage() {
  const [filterTag, setFilterTag] = useState<FilterTag>('all')
  const [sortKey, setSortKey] = useState<SortKey>('winRate')
  const [search, setSearch] = useState('')
  const [selectedTrader, setSelectedTrader] = useState<Trader | null>(null)
  const [copyTarget, setCopyTarget] = useState<Trader | null>(null)

  const filtered = useMemo(() => {
    let list = [...TRADERS]
    if (filterTag !== 'all') list = list.filter(t => t.tags.includes(filterTag))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.address.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      switch (sortKey) {
        case 'winRate': return b.winRate7d - a.winRate7d
        case 'pnl': return b.pnlUsd7d - a.pnlUsd7d
        case 'trades': return b.totalTrades7d - a.totalTrades7d
        case 'followers': return b.followers - a.followers
        case 'copyTraders': return b.copyTraders - a.copyTraders
      }
    })
    return list
  }, [filterTag, sortKey, search])

  if (selectedTrader) {
    return <TraderProfile trader={selectedTrader} onBack={() => setSelectedTrader(null)} />
  }

  const topStats = {
    totalTraders: TRADERS.length,
    avgWinRate: (TRADERS.reduce((s, t) => s + t.winRate7d, 0) / TRADERS.length).toFixed(1),
    totalPnl: fmtUsd(TRADERS.reduce((s, t) => s + t.pnlUsd7d, 0)),
    totalCopiers: TRADERS.reduce((s, t) => s + t.copyTraders, 0),
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-ax-border shrink-0 bg-ax-nav flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <Zap size={14} className="text-green-DEFAULT" />
          <span className="text-sm font-bold text-text-primary">CopyTrade</span>
          <span className="badge badge-green">LIVE</span>
        </div>

        {/* Summary chips */}
        <div className="hidden lg:flex items-center gap-2">
          {[
            { icon: <Users size={10} />, label: 'Traders', val: topStats.totalTraders },
            { icon: <TrendingUp size={10} />, label: 'Avg Win Rate', val: `${topStats.avgWinRate}%` },
            { icon: <Star size={10} />, label: '7D PnL', val: topStats.totalPnl },
            { icon: <Zap size={10} />, label: 'Copiers', val: topStats.totalCopiers },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1.5 bg-ax-card border border-ax-border rounded-lg px-2.5 py-1.5 text-2xs text-text-muted">
              <span className="text-text-muted">{s.icon}</span>
              <span>{s.label}:</span>
              <span className="text-text-primary font-semibold">{s.val}</span>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs ml-auto">
          <div className="flex items-center gap-2 ax-input px-3 h-7 rounded-lg">
            <Search size={11} className="text-text-muted shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search wallet or name..."
              className="flex-1 bg-transparent text-xs text-text-primary outline-none placeholder-text-muted"
            />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-0 px-4 py-2 border-b border-ax-border shrink-0 overflow-x-auto">
        {(Object.keys(TAG_LABELS) as FilterTag[]).map(tag => (
          <button key={tag} onClick={() => setFilterTag(tag)}
            className={clsx('scan-tab whitespace-nowrap', filterTag === tag && 'active')}>
            {TAG_LABELS[tag]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Filter size={11} className="text-text-muted" />
          <span className="text-2xs text-text-muted mr-1">Sort:</span>
          {SORT_OPTIONS.map(s => (
            <button key={s.id} onClick={() => setSortKey(s.id)}
              className={clsx('px-2.5 py-1 text-2xs rounded-md transition-colors font-medium', sortKey === s.id ? 'bg-green-DEFAULT text-ax-base' : 'text-text-muted hover:text-text-primary')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[32px_2fr_100px_120px_70px_80px_80px_100px] gap-2 px-4 py-2 border-b border-ax-border shrink-0 bg-ax-sidebar">
        <div className="text-2xs text-text-muted text-center">#</div>
        <div className="text-2xs text-text-muted">Trader</div>
        <div className="text-2xs text-text-muted">Win Rate</div>
        <div className="text-2xs text-text-muted">7D PnL</div>
        <div className="text-2xs text-text-muted text-right">Trades</div>
        <div className="text-2xs text-text-muted text-right">Avg Hold</div>
        <div className="text-2xs text-text-muted text-right">Followers</div>
        <div className="text-2xs text-text-muted text-right">Actions</div>
      </div>

      {/* Table body */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-text-muted gap-2">
            <Users size={24} className="opacity-30" />
            <span className="text-xs">No traders found</span>
          </div>
        ) : (
          filtered.map((trader, i) => (
            <TraderRow
              key={trader.id}
              trader={trader}
              rank={i + 1}
              onSelect={setSelectedTrader}
              onCopy={setCopyTarget}
            />
          ))
        )}
      </div>

      {/* Footer info */}
      <div className="px-4 py-2 border-t border-ax-border shrink-0 flex items-center gap-3 text-2xs text-text-muted">
        <span>{filtered.length} traders shown</span>
        <span>•</span>
        <span>Click a trader to view full profile</span>
        <span>•</span>
        <span className="text-green-DEFAULT">Data refreshed every 30s</span>
      </div>

      {copyTarget && <CopyTradeModal trader={copyTarget} onClose={() => setCopyTarget(null)} />}
    </div>
  )
}
