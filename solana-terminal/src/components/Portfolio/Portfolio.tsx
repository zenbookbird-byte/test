import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Wallet, TrendingUp, TrendingDown, RefreshCw, ExternalLink } from 'lucide-react'
import { useWalletTokens } from '../../hooks/useWalletTokens'
import { useTerminalStore } from '../../store/terminalStore'
import { getTokenPairs } from '../../services/dexscreener'
import clsx from 'clsx'

export function Portfolio() {
  const { publicKey } = useWallet()
  const { data: tokens, isLoading, isFetching, refetch } = useWalletTokens()
  const { setSelectedPair, setMainTab } = useTerminalStore()

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="w-16 h-16 rounded-full bg-purple-DEFAULT/10 border border-purple-DEFAULT/20 flex items-center justify-center">
          <Wallet size={28} className="text-purple-DEFAULT" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-text-primary mb-1">Connect Your Wallet</div>
          <div className="text-sm text-text-secondary">View your Solana portfolio and trade tokens</div>
        </div>
        <WalletMultiButton />
      </div>
    )
  }

  const totalValue = tokens?.reduce((sum, t) => sum + t.valueUsd, 0) ?? 0

  async function onTokenClick(mint: string) {
    try {
      const pairs = await getTokenPairs(mint)
      if (pairs.length > 0) {
        setSelectedPair(pairs[0])
        setMainTab('trending')
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-ax-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-text-muted">Total Portfolio Value</div>
            <div className="text-2xl font-bold font-mono text-text-primary">
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className={clsx('w-7 h-7 rounded-lg bg-ax-card border border-ax-border flex items-center justify-center text-text-muted hover:text-text-primary transition-colors', isFetching && 'animate-spin')}
            >
              <RefreshCw size={12} />
            </button>
            <a
              href={`https://solscan.io/account/${publicKey.toBase58()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 rounded-lg bg-ax-card border border-ax-border flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <div className="text-xs font-mono text-text-muted bg-ax-card rounded-lg px-3 py-1.5">
          {publicKey.toBase58().slice(0, 12)}...{publicKey.toBase58().slice(-8)}
        </div>
      </div>

      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-ax-card rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !tokens || tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <div className="text-sm">No tokens found</div>
          </div>
        ) : (
          <div className="p-2">
            {tokens.map(token => {
              const pct = totalValue > 0 ? (token.valueUsd / totalValue) * 100 : 0
              return (
                <button
                  key={token.mint}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-ax-hover transition-colors text-left"
                  onClick={() => onTokenClick(token.mint)}
                >
                  <TokenAvatar token={token} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text-primary">{token.symbol}</span>
                      <span className="text-sm font-mono font-medium text-text-primary">
                        ${token.valueUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-text-secondary">{token.balance.toFixed(4)}</span>
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-xs font-mono', token.change24h >= 0 ? 'text-green-DEFAULT' : 'text-red-DEFAULT')}>
                          {token.change24h >= 0 ? <TrendingUp size={10} className="inline" /> : <TrendingDown size={10} className="inline" />}
                          {' '}{Math.abs(token.change24h).toFixed(2)}%
                        </span>
                        <span className="text-xs text-text-muted">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    {/* Allocation bar */}
                    <div className="mt-1.5 h-0.5 bg-ax-card rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-DEFAULT to-blue-accent rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TokenAvatar({ token }: { token: { logoURI?: string; symbol: string } }) {
  if (token.logoURI) {
    return (
      <img
        src={token.logoURI}
        alt={token.symbol}
        width={36}
        height={36}
        className="w-9 h-9 rounded-full object-cover shrink-0"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-DEFAULT/30 to-blue-accent/30 flex items-center justify-center text-text-primary text-sm font-bold shrink-0">
      {token.symbol[0]}
    </div>
  )
}
