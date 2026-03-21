import { useState } from 'react'
import { ExternalLink, Copy, Check, Globe, Twitter, MessageCircle, TrendingUp, TrendingDown, BarChart2, Droplets, Users } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { formatNumber, formatPercent, formatAge } from '../../services/dexscreener'
import clsx from 'clsx'

export function TokenInfoPanel() {
  const { selectedPair } = useTerminalStore()
  const [copied, setCopied] = useState(false)

  if (!selectedPair) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-4">
        <BarChart2 size={32} className="mb-2 opacity-30" />
        <div className="text-sm">Select a token</div>
      </div>
    )
  }

  const p = selectedPair
  const price = parseFloat(p.priceUsd ?? '0')
  const c24 = p.priceChange?.h24 ?? 0
  const c1h = p.priceChange?.h1 ?? 0
  const c5m = p.priceChange?.m5 ?? 0
  const address = p.baseToken.address

  function copyAddress() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function formatPrice(n: number) {
    if (n >= 1) return `$${n.toFixed(4)}`
    if (n >= 0.0001) return `$${n.toFixed(6)}`
    if (n > 0) {
      // Scientific-like notation for very small numbers
      const str = n.toFixed(12)
      const match = str.match(/^0\.0*/)
      if (match) {
        const zeros = match[0].length - 2
        const rest = str.slice(match[0].length)
        return `$0.0…${zeros}${rest.slice(0, 4)}`
      }
    }
    return `$${n.toFixed(8)}`
  }

  const socials = p.info?.socials ?? []
  const websites = p.info?.websites ?? []
  const twitter = socials.find(s => s.type === 'twitter')
  const telegram = socials.find(s => s.type === 'telegram')
  const website = websites[0]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start gap-3 mb-3">
          <TokenImage pair={p} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-text-primary">{p.baseToken.symbol}</span>
              <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">{p.dexId}</span>
            </div>
            <div className="text-xs text-text-secondary truncate mt-0.5">{p.baseToken.name}</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs font-mono text-text-muted">{address.slice(0, 8)}...{address.slice(-4)}</span>
              <button onClick={copyAddress} className="text-text-muted hover:text-accent-blue transition-colors">
                {copied ? <Check size={11} className="text-accent-green" /> : <Copy size={11} />}
              </button>
              <a
                href={`https://solscan.io/token/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-accent-blue transition-colors"
              >
                <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="flex items-end gap-3">
          <span className="text-2xl font-bold font-mono text-text-primary">{formatPrice(price)}</span>
          <span className={clsx('text-sm font-mono mb-0.5', c24 >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {c24 >= 0 ? <TrendingUp size={14} className="inline mr-1" /> : <TrendingDown size={14} className="inline mr-1" />}
            {formatPercent(c24)}
          </span>
        </div>

        {/* Change row */}
        <div className="flex gap-3 mt-2">
          <ChangeChip label="5m" value={c5m} />
          <ChangeChip label="1h" value={c1h} />
          <ChangeChip label="24h" value={c24} />
          <ChangeChip label="6h" value={p.priceChange?.h6} />
        </div>
      </div>

      {/* Stats */}
      <div className="p-4 border-b border-border grid grid-cols-2 gap-3">
        <StatBox label="Market Cap" value={formatNumber(p.marketCap ?? p.fdv)} icon={<BarChart2 size={12} />} />
        <StatBox label="FDV" value={formatNumber(p.fdv)} icon={<BarChart2 size={12} />} />
        <StatBox label="Liquidity" value={formatNumber(p.liquidity?.usd)} icon={<Droplets size={12} />} />
        <StatBox label="Volume 24h" value={formatNumber(p.volume?.h24)} icon={<TrendingUp size={12} />} />
        <StatBox label="Volume 1h" value={formatNumber(p.volume?.h1)} icon={<TrendingUp size={12} />} />
        <StatBox label="Age" value={formatAge(p.pairCreatedAt)} icon={<Users size={12} />} />
      </div>

      {/* Transactions */}
      <div className="p-4 border-b border-border">
        <div className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Transactions</div>
        <div className="space-y-1.5">
          {([
            { label: '5m', buys: p.txns?.m5?.buys, sells: p.txns?.m5?.sells },
            { label: '1h', buys: p.txns?.h1?.buys, sells: p.txns?.h1?.sells },
            { label: '24h', buys: p.txns?.h24?.buys, sells: p.txns?.h24?.sells },
          ]).map(row => {
            const total = (row.buys ?? 0) + (row.sells ?? 0)
            const buyPct = total ? ((row.buys ?? 0) / total) * 100 : 50
            return (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-6">{row.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                  <div
                    className="h-full bg-accent-green rounded-full"
                    style={{ width: `${buyPct}%` }}
                  />
                </div>
                <span className="text-xs text-accent-green w-8 text-right">{row.buys ?? 0}</span>
                <span className="text-xs text-text-muted">/</span>
                <span className="text-xs text-accent-red w-8">{row.sells ?? 0}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Links */}
      {(twitter || telegram || website) && (
        <div className="p-4">
          <div className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Links</div>
          <div className="flex flex-wrap gap-2">
            {website && (
              <SocialLink href={website.url} icon={<Globe size={12} />} label="Website" />
            )}
            {twitter && (
              <SocialLink href={twitter.url} icon={<Twitter size={12} />} label="Twitter" />
            )}
            {telegram && (
              <SocialLink href={telegram.url} icon={<MessageCircle size={12} />} label="Telegram" />
            )}
            <SocialLink
              href={`https://dexscreener.com/solana/${p.pairAddress}`}
              icon={<ExternalLink size={12} />}
              label="DexScreener"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function TokenImage({ pair }: { pair: { info?: { imageUrl?: string }; baseToken: { symbol: string } } }) {
  const [err, setErr] = useState(false)
  const img = pair.info?.imageUrl
  const sym = pair.baseToken.symbol
  if (!img || err) {
    return (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-purple/50 to-accent-blue/50 flex items-center justify-center text-text-primary font-bold text-sm shrink-0">
        {sym[0]}
      </div>
    )
  }
  return (
    <img
      src={img}
      alt={sym}
      width={40}
      height={40}
      className="w-10 h-10 rounded-full object-cover shrink-0"
      onError={() => setErr(true)}
    />
  )
}

function ChangeChip({ label, value }: { label: string; value: number | undefined }) {
  const v = value ?? 0
  return (
    <div className={clsx(
      'flex flex-col items-center px-2 py-1 rounded text-xs border',
      v >= 0 ? 'text-accent-green border-accent-green/20 bg-accent-green/5' : 'text-accent-red border-accent-red/20 bg-accent-red/5'
    )}>
      <span className="text-text-muted text-xs">{label}</span>
      <span className="font-mono font-medium">{formatPercent(v)}</span>
    </div>
  )
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-bg-tertiary rounded-lg p-2.5">
      <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-mono font-semibold text-text-primary">{value}</div>
    </div>
  )
}

function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary bg-bg-tertiary border border-border hover:border-border-light rounded-lg px-2.5 py-1.5 transition-colors"
    >
      {icon}
      {label}
    </a>
  )
}
