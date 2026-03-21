import { useState } from 'react'
import { Copy, Check, ExternalLink, Globe, Twitter, MessageCircle, TrendingUp, TrendingDown, Droplets, BarChart2, Clock } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { formatNumber, formatPercent, formatAge } from '../../services/dexscreener'
import clsx from 'clsx'

export function TokenInfoPanel() {
  const { selectedPair } = useTerminalStore()
  const [copied, setCopied] = useState(false)

  if (!selectedPair) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
        <BarChart2 size={28} className="opacity-20" />
        <span className="text-xs">Select a token to view info</span>
      </div>
    )
  }

  const p = selectedPair
  const price = parseFloat(p.priceUsd ?? '0')
  const c24 = p.priceChange?.h24 ?? 0
  const address = p.baseToken.address
  const socials = p.info?.socials ?? []
  const websites = p.info?.websites ?? []
  const twitter = socials.find(s => s.type === 'twitter')
  const telegram = socials.find(s => s.type === 'telegram')

  function copyAddress() {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function fmt(n: number) {
    if (n === 0) return '$0'
    if (n >= 1) return `$${n.toFixed(4)}`
    const s = n.toFixed(12)
    const match = s.match(/^0\.(0+)/)
    if (match) return `$0.0(${match[1].length})${s.slice(2 + match[1].length, 6 + match[1].length)}`
    return `$${n.toFixed(8)}`
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Price header */}
      <div className="p-3 border-b border-ax-border">
        <div className="flex items-center gap-2 mb-2">
          <TokenImg pair={p} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-text-primary">{p.baseToken.symbol}</span>
              <span className="text-xs text-text-muted bg-ax-card border border-ax-border px-1.5 rounded">{p.dexId}</span>
            </div>
            <div className="text-xs text-text-muted truncate">{p.baseToken.name}</div>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-xl font-bold font-mono text-text-primary">{fmt(price)}</span>
          <span className={clsx('text-xs font-mono flex items-center gap-0.5', c24 >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
            {c24 >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {formatPercent(c24)}
          </span>
        </div>

        {/* Address */}
        <div className="flex items-center gap-1.5 bg-ax-card border border-ax-border rounded-lg px-2 py-1">
          <span className="text-xs font-mono text-text-muted flex-1 truncate">{address.slice(0, 16)}...{address.slice(-6)}</span>
          <button onClick={copyAddress} className="text-text-muted hover:text-blue-accent transition-colors shrink-0">
            {copied ? <Check size={11} className="text-green-DEFAULT" /> : <Copy size={11} />}
          </button>
          <a href={`https://solscan.io/token/${address}`} target="_blank" rel="noopener noreferrer"
            className="text-text-muted hover:text-blue-accent transition-colors shrink-0">
            <ExternalLink size={11} />
          </a>
          <a href={`https://dexscreener.com/solana/${p.pairAddress}`} target="_blank" rel="noopener noreferrer"
            className="text-text-muted hover:text-blue-accent transition-colors text-xs shrink-0">DS</a>
        </div>
      </div>

      {/* Change grid */}
      <div className="grid grid-cols-4 border-b border-ax-border">
        {[
          { label: '5m', val: p.priceChange?.m5 },
          { label: '1h', val: p.priceChange?.h1 },
          { label: '6h', val: p.priceChange?.h6 },
          { label: '24h', val: p.priceChange?.h24 },
        ].map(c => (
          <div key={c.label} className="flex flex-col items-center py-2 border-r border-ax-border last:border-0">
            <span className="text-xs text-text-muted">{c.label}</span>
            <span className={clsx('text-xs font-mono font-semibold', (c.val ?? 0) >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
              {formatPercent(c.val ?? 0)}
            </span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="p-3 grid grid-cols-2 gap-2 border-b border-ax-border">
        <StatBox label="Market Cap" value={formatNumber(p.marketCap ?? p.fdv)} icon={<BarChart2 size={11} />} />
        <StatBox label="FDV" value={formatNumber(p.fdv)} icon={<BarChart2 size={11} />} />
        <StatBox label="Liquidity" value={formatNumber(p.liquidity?.usd)} icon={<Droplets size={11} />} />
        <StatBox label="Volume 24h" value={formatNumber(p.volume?.h24)} icon={<TrendingUp size={11} />} />
        <StatBox label="Volume 1h" value={formatNumber(p.volume?.h1)} icon={<TrendingUp size={11} />} />
        <StatBox label="Age" value={formatAge(p.pairCreatedAt)} icon={<Clock size={11} />} />
      </div>

      {/* Txn flow */}
      <div className="p-3 border-b border-ax-border">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Txn Flow</div>
        <div className="space-y-1.5">
          {([
            { label: '5m', b: p.txns?.m5?.buys, s: p.txns?.m5?.sells },
            { label: '1h', b: p.txns?.h1?.buys, s: p.txns?.h1?.sells },
            { label: '24h', b: p.txns?.h24?.buys, s: p.txns?.h24?.sells },
          ]).map(row => {
            const t = (row.b ?? 0) + (row.s ?? 0)
            const bp = t ? ((row.b ?? 0) / t) * 100 : 50
            return (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-5">{row.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-red-DEFAULT/20 overflow-hidden">
                  <div className="h-full bg-green-DEFAULT rounded-full transition-all" style={{ width: `${bp}%` }} />
                </div>
                <span className="text-xs text-green-DEFAULT w-6 text-right font-mono">{row.b ?? 0}</span>
                <span className="text-xs text-text-muted">/</span>
                <span className="text-xs text-red-DEFAULT w-6 font-mono">{row.s ?? 0}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Links */}
      <div className="p-3 flex flex-wrap gap-1.5">
        {websites[0] && <SocialLink href={websites[0].url} icon={<Globe size={11} />} label="Web" />}
        {twitter && <SocialLink href={twitter.url} icon={<Twitter size={11} />} label="Twitter" />}
        {telegram && <SocialLink href={telegram.url} icon={<MessageCircle size={11} />} label="Telegram" />}
        <SocialLink href={`https://birdeye.so/token/${address}?chain=solana`} icon={<ExternalLink size={11} />} label="Birdeye" />
        <SocialLink href={`https://rugcheck.xyz/tokens/${address}`} icon={<ExternalLink size={11} />} label="RugCheck" />
      </div>
    </div>
  )
}

function TokenImg({ pair }: { pair: { info?: { imageUrl?: string }; baseToken: { symbol: string } } }) {
  const [err, setErr] = useState(false)
  const img = pair.info?.imageUrl
  const sym = pair.baseToken.symbol
  if (!img || err) {
    return (
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-accent/30 to-purple-DEFAULT/30 flex items-center justify-center font-bold text-text-primary text-sm shrink-0">
        {sym[0]}
      </div>
    )
  }
  return <img src={img} alt={sym} width={36} height={36} className="w-9 h-9 rounded-full object-cover shrink-0" onError={() => setErr(true)} />
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-ax-card border border-ax-border rounded-lg p-2">
      <div className="flex items-center gap-1 text-xs text-text-muted mb-0.5">{icon}{label}</div>
      <div className="text-xs font-mono font-semibold text-text-primary">{value}</div>
    </div>
  )
}

function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-text-secondary hover:text-blue-accent bg-ax-card border border-ax-border hover:border-cyan/30 rounded-lg px-2 py-1 transition-colors">
      {icon}{label}
    </a>
  )
}
