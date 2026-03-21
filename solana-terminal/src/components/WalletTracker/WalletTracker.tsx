import { useState } from 'react'
import { Search, Plus, X, ExternalLink } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getTokenPairs } from '../../services/dexscreener'
import clsx from 'clsx'

interface TrackedWallet {
  address: string
  label: string
  addedAt: number
}

function useTrackedWallets() {
  const [wallets, setWallets] = useState<TrackedWallet[]>(() => {
    try { return JSON.parse(localStorage.getItem('st_tracked_wallets') || '[]') }
    catch { return [] }
  })

  function add(address: string, label: string) {
    const next = [...wallets.filter(w => w.address !== address), { address, label, addedAt: Date.now() }]
    setWallets(next)
    localStorage.setItem('st_tracked_wallets', JSON.stringify(next))
  }

  function remove(address: string) {
    const next = wallets.filter(w => w.address !== address)
    setWallets(next)
    localStorage.setItem('st_tracked_wallets', JSON.stringify(next))
  }

  return { wallets, add, remove }
}

// Mock trade history for a wallet (in production: use Helius/Shyft API)
function mockWalletHistory(address: string) {
  const seed = address.charCodeAt(0) + address.charCodeAt(1)
  return Array.from({ length: 5 }, (_, i) => {
    const syms = ['BONK', 'WIF', 'POPCAT', 'MEW', 'BOME', 'MYRO', 'SILLY']
    const sym = syms[(seed + i) % syms.length]
    const isBuy = (seed + i) % 3 !== 0
    const amount = ((seed % 10) + 1) * 0.1 + i * 0.05
    const pnl = isBuy ? 0 : ((Math.random() - 0.3) * 100)
    return { sym, isBuy, amount, pnl, time: Date.now() - i * 3600000 * 2 }
  })
}

export function WalletTracker() {
  const { setSelectedPair } = useTerminalStore()
  const { wallets, add, remove } = useTrackedWallets()
  const [input, setInput] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  function handleAdd() {
    const addr = input.trim()
    if (addr.length < 32) return
    add(addr, label.trim() || `Wallet ${wallets.length + 1}`)
    setInput('')
    setLabel('')
    setAdding(false)
  }

  async function onTokenClick(sym: string) {
    try {
      const pairs = await getTokenPairs(sym)
      if (pairs.length > 0) setSelectedPair(pairs[0])
    } catch { /* ignore */ }
  }

  function timeAgo(ts: number) {
    const s = Math.floor((Date.now() - ts) / 1000)
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-ax-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-text-primary">Wallet Tracker</span>
          <button
            onClick={() => setAdding(!adding)}
            className="flex items-center gap-1 text-xs text-blue-accent bg-cyan/10 border border-cyan/20 px-2 py-1 rounded-lg hover:bg-cyan/20 transition-colors"
          >
            <Plus size={11} />
            Track Wallet
          </button>
        </div>

        {adding && (
          <div className="space-y-1.5 animate-slide-in">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Wallet address (base58)"
              className="w-full bg-ax-card border border-ax-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-cyan/40"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="flex-1 bg-ax-card border border-ax-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-cyan/40"
              />
              <button
                onClick={handleAdd}
                disabled={input.trim().length < 32}
                className="px-3 py-1.5 bg-cyan/10 text-blue-accent border border-cyan/30 rounded-lg text-xs font-medium hover:bg-cyan/20 transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Wallet list */}
      <div className="flex-1 overflow-y-auto">
        {wallets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
            <Search size={24} className="text-text-muted opacity-40" />
            <div className="text-xs text-text-muted">
              Track wallets to see their trades and follow smart money
            </div>
          </div>
        ) : (
          wallets.map(w => {
            const isExpanded = expanded === w.address
            const history = mockWalletHistory(w.address)
            const pnl = history.filter(t => !t.isBuy).reduce((s, t) => s + t.pnl, 0)

            return (
              <div key={w.address} className="border-b border-ax-border">
                {/* Wallet row */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-ax-hover transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : w.address)}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-accent/20 to-purple-DEFAULT/20 flex items-center justify-center text-xs font-bold text-blue-accent shrink-0">
                    {w.label[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-primary">{w.label}</div>
                    <div className="text-xs font-mono text-text-muted truncate">
                      {w.address.slice(0, 8)}...{w.address.slice(-6)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={clsx('text-xs font-mono font-semibold', pnl >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}%
                    </div>
                    <div className="text-xs text-text-muted">est PnL</div>
                  </div>
                  <div className="flex items-center gap-1 ml-1">
                    <a
                      href={`https://solscan.io/account/${w.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-text-muted hover:text-blue-accent transition-colors"
                    >
                      <ExternalLink size={11} />
                    </a>
                    <button
                      onClick={e => { e.stopPropagation(); remove(w.address) }}
                      className="text-text-muted hover:text-red-DEFAULT transition-colors"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>

                {/* Expanded trade history */}
                {isExpanded && (
                  <div className="bg-ax-sidebar border-t border-ax-border animate-slide-in">
                    <div className="px-3 py-1.5 text-xs text-text-muted border-b border-ax-border">Recent trades</div>
                    {history.map((trade, i) => (
                      <button
                        key={i}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-ax-hover transition-colors text-left border-b border-ax-border/40"
                        onClick={() => onTokenClick(trade.sym)}
                      >
                        <span className={clsx('shrink-0 font-bold', trade.isBuy ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                          {trade.isBuy ? '▲' : '▼'}
                        </span>
                        <span className="font-semibold text-text-primary">{trade.sym}</span>
                        <span className="text-text-muted">{trade.amount.toFixed(2)} SOL</span>
                        {!trade.isBuy && (
                          <span className={clsx('ml-auto font-mono', trade.pnl >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(0)}%
                          </span>
                        )}
                        <span className="text-text-muted ml-auto">{timeAgo(trade.time)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
