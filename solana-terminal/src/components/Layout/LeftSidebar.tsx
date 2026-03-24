import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Plus, Send, MessageCircle, Copy, ExternalLink } from 'lucide-react'
import { useSOLBalance } from '../../hooks/useWalletTokens'
import { useWalletTokens } from '../../hooks/useWalletTokens'
import clsx from 'clsx'

interface ChatMsg { id: number; user: string; msg: string; time: string; color: string }

const DEMO_MSGS: ChatMsg[] = [
  { id: 1, user: 'degen_ape', msg: 'WIF looking strong rn', time: '2m', color: '#16c784' },
  { id: 2, user: 'moonboy99', msg: 'BONK about to pump trust', time: '5m', color: '#3772ff' },
  { id: 3, user: 'rugpull_detector', msg: 'be careful with new launches today', time: '8m', color: '#f5b24b' },
  { id: 4, user: 'solana_trader', msg: 'anyone in POPCAT?', time: '12m', color: '#ea3943' },
]

export function LeftSidebar() {
  const { publicKey, connected } = useWallet()
  const { data: solBal = 0 } = useSOLBalance()
  const { data: tokens } = useWalletTokens()
  const [chatInput, setChatInput] = useState('')
  const [onlineCount] = useState(() => 7200 + Math.floor(Math.random() * 100))
  const [msgs, setMsgs] = useState<ChatMsg[]>(DEMO_MSGS)
  const [, setCopied] = useState(false)

  const totalValue = tokens?.reduce((s, t) => s + t.valueUsd, 0) ?? 0

  function sendMsg(e: React.FormEvent) {
    e.preventDefault()
    if (!chatInput.trim()) return
    setMsgs(prev => [...prev, {
      id: Date.now(), user: 'you', msg: chatInput.trim(), time: 'now',
      color: '#16c784'
    }])
    setChatInput('')
  }

  function copyAddress() {
    if (!publicKey) return
    navigator.clipboard.writeText(publicKey.toBase58())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <aside className="w-52 shrink-0 bg-ax-sidebar border-r border-ax-border flex flex-col h-full overflow-hidden">
      {/* Lobby header */}
      <div className="px-3 py-2.5 border-b border-ax-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-DEFAULT animate-pulse" />
            <span className="text-xs font-semibold text-text-primary">Lobby</span>
          </div>
          <button className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded transition-colors">
            <Plus size={10} />
          </button>
        </div>

        {/* Wallet card */}
        {connected && publicKey ? (
          <div className="bg-ax-card border border-ax-border rounded-lg p-2.5">
            {/* Avatar + address */}
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-DEFAULT/30 to-blue-accent/30 flex items-center justify-center font-bold text-xs text-green-DEFAULT">
                {publicKey.toBase58().slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-2xs font-mono text-text-secondary truncate">{publicKey.toBase58().slice(0, 8)}...</span>
                  <button onClick={copyAddress} className="text-text-muted hover:text-text-primary">
                    <Copy size={9} />
                  </button>
                  <a href={`https://solscan.io/account/${publicKey.toBase58()}`} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-green-DEFAULT">
                    <ExternalLink size={9} />
                  </a>
                </div>
              </div>
            </div>

            {/* Balance / PnL */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-2xs text-text-muted mb-0.5">Balance</div>
                <div className="text-sm font-bold font-mono text-text-primary">
                  {totalValue > 0 ? `$${totalValue.toFixed(0)}` : `${solBal.toFixed(3)} ◎`}
                </div>
              </div>
              <div>
                <div className="text-2xs text-text-muted mb-0.5">PnL</div>
                <div className="text-sm font-bold font-mono text-green-DEFAULT">+$0</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-ax-card border border-ax-border rounded-lg p-3 flex flex-col items-center gap-2">
            <div className="text-2xs text-text-muted text-center">Connect wallet to view balance</div>
            <WalletMultiButton />
          </div>
        )}
      </div>

      {/* Watchlist / positions */}
      <div className="px-3 py-2 border-b border-ax-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">Positions</span>
        </div>
        {tokens && tokens.filter(t => t.valueUsd > 0.5).slice(0, 3).map(t => (
          <div key={t.mint} className="flex items-center justify-between py-1 hover:bg-ax-hover rounded px-1 -mx-1 cursor-pointer transition-colors">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-ax-card flex items-center justify-center text-2xs font-bold text-green-DEFAULT shrink-0">
                {t.symbol[0]}
              </div>
              <span className="text-xs text-text-primary">{t.symbol.slice(0, 8)}</span>
            </div>
            <div className="text-right">
              <div className="text-2xs font-mono text-text-primary">${t.valueUsd.toFixed(1)}</div>
              <div className={clsx('text-2xs font-mono', t.change24h >= 0 ? 'pos' : 'neg')}>
                {t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(1)}%
              </div>
            </div>
          </div>
        ))}
        {(!tokens || tokens.filter(t => t.valueUsd > 0.5).length === 0) && (
          <div className="text-2xs text-text-muted py-2">No open positions</div>
        )}
      </div>

      {/* Community chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ax-border">
          <MessageCircle size={11} className="text-text-muted" />
          <span className="text-2xs font-semibold text-text-muted uppercase tracking-wider">Community</span>
          <span className="ml-auto text-2xs text-green-DEFAULT">● {onlineCount} online</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {msgs.map(m => (
            <div key={m.id} className="text-2xs animate-fade-in">
              <span className="font-semibold" style={{ color: m.color }}>{m.user}</span>
              <span className="text-text-muted ml-1">{m.time}</span>
              <div className="text-text-secondary mt-0.5">{m.msg}</div>
            </div>
          ))}
        </div>
        <form onSubmit={sendMsg} className="flex items-center gap-1.5 p-2 border-t border-ax-border">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 ax-input px-2 py-1 text-2xs rounded-lg"
          />
          <button type="submit" className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-green-DEFAULT transition-colors">
            <Send size={11} />
          </button>
        </form>
      </div>
    </aside>
  )
}
