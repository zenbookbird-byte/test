import { useState } from 'react'
import { ArrowLeft, Copy, Star, Share2, ExternalLink, Shield, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import type { Trader } from './traderData'
import { AVATAR_COLORS, fmtUsd } from './traderData'
import { CopyTradeModal } from './CopyTradeModal'
import clsx from 'clsx'

type Period = '1D' | '7D' | '30D' | 'All'
type ProfileTab = 'pnl' | 'holdings' | 'trades' | 'deployed'

function PnlCalendar({ dailyPnl }: { dailyPnl: Trader['dailyPnl'] }) {
  const max = Math.max(...dailyPnl.map(d => Math.abs(d.pnlUsd)), 1)
  const weeks: typeof dailyPnl[] = []
  let week: typeof dailyPnl = []
  dailyPnl.forEach((d, i) => {
    week.push(d)
    if ((i + 1) % 7 === 0) { weeks.push(week); week = [] }
  })
  if (week.length) weeks.push(week)

  return (
    <div className="flex gap-1">
      {weeks.map((wk, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {wk.map((day, di) => {
            const intensity = Math.min(1, Math.abs(day.pnlUsd) / max)
            const isPos = day.pnlUsd >= 0
            const bg = day.pnlUsd === 0
              ? 'bg-ax-card border border-ax-border'
              : isPos
                ? intensity > 0.7 ? 'bg-green-DEFAULT' : intensity > 0.35 ? 'bg-green-DEFAULT/60' : 'bg-green-DEFAULT/25'
                : intensity > 0.7 ? 'bg-red-DEFAULT' : intensity > 0.35 ? 'bg-red-DEFAULT/60' : 'bg-red-DEFAULT/25'
            return (
              <div key={di} title={`${day.date}: ${fmtUsd(day.pnlUsd)} (${day.trades} trades)`}
                className={clsx('w-5 h-5 rounded-sm cursor-pointer transition-transform hover:scale-125', bg)} />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ax-border/50 last:border-0">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={clsx('text-xs font-mono font-semibold', valueClass ?? 'text-text-primary')}>{value}</span>
    </div>
  )
}

function DistBar({ label, pct, count, color }: { label: string; pct: number; count?: number; color: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className={clsx('w-2 h-2 rounded-full shrink-0', color)} />
      <span className="text-2xs text-text-secondary w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-ax-card rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs text-text-muted w-12 text-right font-mono">{pct.toFixed(1)}%{count !== undefined ? ` (${count})` : ''}</span>
    </div>
  )
}

interface Props {
  trader: Trader
  onBack: () => void
}

export function TraderProfile({ trader: t, onBack }: Props) {
  const [period, setPeriod] = useState<Period>('7D')
  const [tab, setTab] = useState<ProfileTab>('holdings')
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [copied, setCopied] = useState(false)

  function copyAddr() {
    navigator.clipboard.writeText(t.address).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const mc0Pct = t.mc0to100k / (t.mc0to100k + t.mc100kto500k + t.mcGt500k) * 100
  const mc1Pct = t.mc100kto500k / (t.mc0to100k + t.mc100kto500k + t.mcGt500k) * 100
  const mc2Pct = t.mcGt500k / (t.mc0to100k + t.mc100kto500k + t.mcGt500k) * 100

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ax-base">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-ax-border shrink-0 bg-ax-nav">
        <button onClick={onBack} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors shrink-0">
          <ArrowLeft size={13} />
        </button>

        {/* Avatar */}
        <div className={clsx('w-9 h-9 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-sm font-bold text-white', AVATAR_COLORS[t.avatarSeed])}>
          {(t.name ?? t.address)[0].toUpperCase()}
        </div>

        {/* Address */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {t.name && <span className="text-sm font-bold text-text-primary">{t.name}</span>}
            <span className="text-xs font-mono text-text-muted truncate">{t.address.slice(0, 6)}...{t.address.slice(-6)}</span>
            <button onClick={copyAddr} className="text-text-muted hover:text-green-DEFAULT transition-colors shrink-0">
              {copied ? <CheckCircle2 size={11} className="text-green-DEFAULT" /> : <Copy size={11} />}
            </button>
            {t.verified && <Shield size={11} className="text-blue-accent shrink-0" />}
            <span className="text-2xs text-text-muted">• {t.daysTracked}d</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {t.tags.map(tag => (
              <span key={tag} className={clsx('badge text-2xs px-1.5',
                tag === 'smart' ? 'badge-green' :
                tag === 'whale' ? 'text-blue-accent bg-blue-accent/10 border border-blue-accent/20' :
                tag === 'kol' ? 'text-purple-DEFAULT bg-purple-DEFAULT/10 border border-purple-DEFAULT/20' :
                tag === 'bot' ? 'text-yellow-DEFAULT bg-yellow-DEFAULT/10 border border-yellow-DEFAULT/20' :
                'badge-red'
              )}>
                {tag.toUpperCase()}
              </span>
            ))}
            <span className="text-2xs text-text-muted">{t.copyTraders} copying</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Period */}
          <div className="hidden sm:flex items-center gap-0 bg-ax-card border border-ax-border rounded-lg overflow-hidden">
            {(['1D', '7D', '30D', 'All'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={clsx('px-2.5 py-1.5 text-2xs font-semibold transition-colors', period === p ? 'bg-green-DEFAULT text-ax-base' : 'text-text-muted hover:text-text-primary')}>
                {p}
              </button>
            ))}
          </div>

          <button onClick={() => setShowCopyModal(true)}
            className="btn-buy px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 rounded-lg">
            Copy Trade
          </button>
          <button onClick={() => setTracking(!tracking)}
            className={clsx('px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 rounded-lg border transition-colors',
              tracking ? 'bg-pink-500/20 border-pink-500/40 text-pink-400' : 'bg-ax-card border-ax-border text-text-muted hover:text-text-primary')}>
            <Star size={11} className={tracking ? 'fill-pink-400' : ''} />
            {tracking ? 'Tracked' : 'Track'}
          </button>
          <button className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors">
            <Share2 size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Main column */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          {/* Big stats */}
          <div className="flex items-start gap-6 flex-wrap">
            <div>
              <div className="text-2xs text-text-muted mb-0.5">7D Realized PnL &nbsp; <span className="font-mono text-text-secondary">USD</span></div>
              <div className="text-3xl font-black text-green-DEFAULT font-mono">+{t.pnlPct7d.toFixed(2)}%</div>
              <div className="text-lg font-bold text-green-DEFAULT/80 font-mono">+{fmtUsd(t.pnlUsd7d)}</div>
            </div>
            <div className="text-right">
              <div className="text-2xs text-text-muted mb-0.5">Win Rate</div>
              <div className="text-3xl font-black text-green-DEFAULT font-mono">{t.winRate7d.toFixed(1)}%</div>
              <div className="text-xs text-text-muted font-mono">{t.totalTrades7d} trades (7D)</div>
            </div>
          </div>

          {/* Calendar */}
          <div className="panel p-3">
            <div className="text-2xs text-text-muted mb-2 font-semibold uppercase tracking-wider">Daily PnL — Mar 2026</div>
            <PnlCalendar dailyPnl={t.dailyPnl} />
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1 text-2xs text-text-muted"><span className="w-3 h-3 rounded-sm bg-green-DEFAULT inline-block" />Profit</span>
              <span className="flex items-center gap-1 text-2xs text-text-muted"><span className="w-3 h-3 rounded-sm bg-red-DEFAULT inline-block" />Loss</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="panel overflow-hidden">
            <div className="flex border-b border-ax-border">
              {([
                { id: 'pnl', label: 'Recent PnL' },
                { id: 'holdings', label: 'Holdings' },
                { id: 'trades', label: 'Trades' },
                { id: 'deployed', label: 'Deployed Tokens' },
              ] as const).map(tb => (
                <button key={tb.id} onClick={() => setTab(tb.id)}
                  className={clsx('px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px',
                    tab === tb.id ? 'text-text-primary border-green-DEFAULT' : 'text-text-muted border-transparent hover:text-text-secondary')}>
                  {tb.label}
                </button>
              ))}
            </div>

            {/* Holdings table */}
            {tab === 'holdings' && (
              <div>
                <div className="grid grid-cols-[1fr_80px_80px_80px_70px_80px] gap-2 px-4 py-2 border-b border-ax-border text-2xs text-text-muted">
                  <div>Token / Last Active</div>
                  <div className="text-right">Unrealized</div>
                  <div className="text-right">Realized Profit</div>
                  <div className="text-right">Balance USD</div>
                  <div className="text-right">Position %</div>
                  <div className="text-right">Duration</div>
                </div>
                {t.holdings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                    <div className="text-4xl opacity-30">📭</div>
                    <span className="text-xs">No assets held.</span>
                  </div>
                ) : (
                  t.holdings.map((h, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_80px_80px_70px_80px] gap-2 items-center px-4 py-2.5 border-b border-ax-border/50 hover:bg-ax-hover transition-colors">
                      <div>
                        <div className="text-xs font-bold text-text-primary">{h.symbol}</div>
                        <div className="text-2xs text-text-muted">{h.name}</div>
                      </div>
                      <div className={clsx('text-right text-xs font-mono', h.unrealizedPct >= 0 ? 'pos' : 'neg')}>
                        {h.unrealizedPct >= 0 ? '+' : ''}{h.unrealizedPct.toFixed(1)}%
                      </div>
                      <div className={clsx('text-right text-xs font-mono', h.realizedUsd >= 0 ? 'pos' : 'neg')}>
                        {fmtUsd(h.realizedUsd)}
                      </div>
                      <div className="text-right text-xs font-mono text-text-primary">${h.balanceUsd.toFixed(0)}</div>
                      <div className="text-right text-xs font-mono text-text-primary">{h.position.toFixed(1)}%</div>
                      <div className="text-right text-xs text-text-muted">{h.holdingDuration}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'pnl' && (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                <div className="text-4xl opacity-30">📊</div>
                <span className="text-xs">Recent PnL breakdown</span>
                <div className="grid grid-cols-3 gap-2 mt-2 w-full px-4">
                  {t.dailyPnl.slice(-6).map((d, i) => (
                    <div key={i} className="panel p-2 text-center">
                      <div className="text-2xs text-text-muted">{d.date.slice(5)}</div>
                      <div className={clsx('text-xs font-bold font-mono', d.pnlUsd >= 0 ? 'pos' : 'neg')}>{fmtUsd(d.pnlUsd)}</div>
                      <div className="text-2xs text-text-muted">{d.trades} trades</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'trades' && (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                <div className="text-4xl opacity-30">💼</div>
                <span className="text-xs">Trade history requires on-chain data</span>
                <a href={`https://solscan.io/account/${t.address}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-green-DEFAULT hover:underline">
                  View on Solscan <ExternalLink size={10} />
                </a>
              </div>
            )}

            {tab === 'deployed' && (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                <div className="text-4xl opacity-30">🔧</div>
                <span className="text-xs">No deployed tokens detected</span>
              </div>
            )}
          </div>
        </div>

        {/* Right stats column */}
        <div className="w-72 xl:w-80 shrink-0 border-l border-ax-border overflow-y-auto p-4 space-y-4">
          {/* Analysis */}
          <div className="panel p-3">
            <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider mb-2">Analysis</div>
            <StatRow label="Bal" value={`${t.solBalance.toFixed(2)} SOL (${fmtUsd(t.usdBalance)})`} />
            <StatRow label="7D Avg Duration" value={t.avgDuration7d} />
            <StatRow label="7D Cost" value={fmtUsd(t.cost7d)} />
            <StatRow label="7D Avg Cost / Avg Sold" value={`${fmtUsd(t.avgCostPerBuy7d)} / ${fmtUsd(t.avgSoldPrice7d)}`} valueClass="text-text-primary" />
            <StatRow label="7D Avg Realized Profits" value={`+${fmtUsd(t.avgRealizedProfit7d)}`} valueClass="text-green-DEFAULT" />
            <StatRow label="7D Fees" value={`$${(t.fees7d / 1000).toFixed(0)}K`} />
            <StatRow label="7D Vol" value={fmtUsd(t.volume7d)} />
            <StatRow label="Tracked / Renamed" value={`${t.uniqueTokens7d} / ${t.renamedTokens7d}`} />
          </div>

          {/* Distribution */}
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider">Distribution (Token {t.uniqueTokens7d})</div>
              <span className="text-2xs text-text-muted">Count / %</span>
            </div>
            <div className="space-y-1.5">
              <DistBar label=">500%" pct={t.distGt500} color="bg-green-DEFAULT" />
              <DistBar label="200% ~ 500%" pct={t.dist200to500} color="bg-green-DEFAULT/70" />
              <DistBar label="0% ~ 200%" pct={t.dist0to200} color="bg-green-DEFAULT/40" />
              <DistBar label="-50% ~ 0%" pct={t.distNeg50to0} color="bg-red-DEFAULT/60" />
              <DistBar label="< -50%" pct={t.distLtNeg50} color="bg-red-DEFAULT" />
            </div>
          </div>

          {/* Phishing check */}
          <div className="panel p-3">
            <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider mb-2">🛡 Phishing Check</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: `Blacklist: ${t.blacklistCount} (0%)`, ok: t.blacklistCount === 0 },
                { label: `Didn't buy: ${t.didntBuyCount} (0%)`, ok: t.didntBuyCount === 0 },
                { label: `Sold > Bought: ${t.soldGtBought} (0%)`, ok: t.soldGtBought <= 1 },
                { label: `Buy/Sell in 5s: ${t.buySellIn5s} (${((t.buySellIn5s / t.totalTrades7d) * 100).toFixed(1)}%)`, ok: t.buySellIn5s < 50 },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {item.ok
                    ? <CheckCircle2 size={11} className="text-green-DEFAULT shrink-0" />
                    : <XCircle size={11} className="text-red-DEFAULT shrink-0" />
                  }
                  <span className="text-2xs text-text-secondary">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Avg Buy MC Distribution */}
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider">Avg Buy MC Distribution</div>
              <span className="text-2xs text-text-muted">Count / %</span>
            </div>
            <div className="space-y-1.5">
              <DistBar label="$0 - $100k" pct={mc0Pct} count={t.mc0to100k} color="bg-blue-accent" />
              <DistBar label="$100k - $500k" pct={mc1Pct} count={t.mc100kto500k} color="bg-blue-accent/60" />
              <DistBar label="> $500k" pct={mc2Pct} count={t.mcGt500k} color="bg-blue-accent/30" />
            </div>
          </div>

          {/* Social */}
          <div className="panel p-3">
            <div className="text-2xs font-semibold text-text-muted uppercase tracking-wider mb-2">Social</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center">
                <div className="text-lg font-bold text-text-primary">{t.followers >= 1000 ? `${(t.followers/1000).toFixed(1)}K` : t.followers}</div>
                <div className="text-2xs text-text-muted">Followers</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-DEFAULT">{t.copyTraders}</div>
                <div className="text-2xs text-text-muted">Copying</div>
              </div>
            </div>
          </div>

          {/* Copy CTA */}
          <button onClick={() => setShowCopyModal(true)} className="w-full btn-buy py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
            Copy Trade <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {showCopyModal && <CopyTradeModal trader={t} onClose={() => setShowCopyModal(false)} />}
    </div>
  )
}
