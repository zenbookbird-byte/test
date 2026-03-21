import { useState, useEffect, useCallback } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import { ArrowUpDown, ChevronDown, Zap, Settings, AlertCircle, CheckCircle } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getQuote, getSwapTransaction, SOL_MINT, USDC_MINT } from '../../services/jupiter'
import { useSOLBalance } from '../../hooks/useWalletTokens'
import type { JupiterQuote } from '../../services/jupiter'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const PRIORITY_FEES: Record<string, number> = {
  low: 1000,
  medium: 5000,
  high: 20000,
  ultra: 100000,
}

export function SwapPanel() {
  const { selectedPair, swapSide, setSwapSide, slippage, setSlippage, priorityFee, setPriorityFee, swapInputAmount, setSwapInputAmount } = useTerminalStore()
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const { data: solBalance } = useSOLBalance()

  const [quote, setQuote] = useState<JupiterQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const tokenMint = selectedPair?.baseToken.address
  const inputMint = swapSide === 'buy' ? SOL_MINT : (tokenMint ?? SOL_MINT)
  const outputMint = swapSide === 'buy' ? (tokenMint ?? USDC_MINT) : SOL_MINT
  const inputDecimals = swapSide === 'buy' ? 9 : (selectedPair ? 6 : 9)

  const fetchQuote = useCallback(async () => {
    if (!swapInputAmount || !tokenMint || parseFloat(swapInputAmount) <= 0) {
      setQuote(null)
      return
    }
    setLoading(true)
    try {
      const amount = Math.floor(parseFloat(swapInputAmount) * Math.pow(10, inputDecimals))
      const q = await getQuote(inputMint, outputMint, amount.toString(), Math.floor(slippage * 100))
      setQuote(q)
    } catch (e) {
      setQuote(null)
    } finally {
      setLoading(false)
    }
  }, [swapInputAmount, tokenMint, inputMint, outputMint, slippage, inputDecimals])

  useEffect(() => {
    const t = setTimeout(fetchQuote, 500)
    return () => clearTimeout(t)
  }, [fetchQuote])

  const outAmount = quote
    ? (parseInt(quote.outAmount) / Math.pow(10, swapSide === 'buy' ? 6 : 9)).toFixed(6)
    : '—'

  const priceImpact = quote ? parseFloat(quote.priceImpactPct) * 100 : 0

  async function executeSwap() {
    if (!quote || !publicKey || !signTransaction) {
      toast.error('Connect wallet first')
      return
    }
    setSwapping(true)
    try {
      const swapTx = await getSwapTransaction(quote, publicKey.toBase58(), PRIORITY_FEES[priorityFee])
      if (!swapTx) throw new Error('Failed to get swap transaction')

      const txBuf = Buffer.from(swapTx, 'base64')
      const tx = VersionedTransaction.deserialize(txBuf)
      const signed = await signTransaction(tx)

      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      })

      toast.custom(() => (
        <div className="flex items-center gap-3 bg-bg-card border border-accent-green/30 rounded-xl px-4 py-3 shadow-xl">
          <CheckCircle size={18} className="text-accent-green" />
          <div>
            <div className="text-sm font-medium text-text-primary">Swap submitted!</div>
            <a
              href={`https://solscan.io/tx/${sig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent-blue hover:underline"
            >
              View on Solscan
            </a>
          </div>
        </div>
      ), { duration: 8000 })

      setSwapInputAmount('')
      setQuote(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Swap failed'
      toast.custom(() => (
        <div className="flex items-center gap-3 bg-bg-card border border-accent-red/30 rounded-xl px-4 py-3 shadow-xl">
          <AlertCircle size={18} className="text-accent-red" />
          <div className="text-sm text-text-primary">{msg}</div>
        </div>
      ))
    } finally {
      setSwapping(false)
    }
  }

  const QUICK_AMOUNTS_SOL = [0.1, 0.5, 1, 5]

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
      {/* Buy/Sell toggle */}
      <div className="flex rounded-xl overflow-hidden border border-border">
        <button
          onClick={() => setSwapSide('buy')}
          className={clsx(
            'flex-1 py-2.5 text-sm font-semibold transition-colors',
            swapSide === 'buy'
              ? 'bg-accent-green text-bg-primary'
              : 'text-text-secondary hover:text-text-primary bg-bg-tertiary'
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setSwapSide('sell')}
          className={clsx(
            'flex-1 py-2.5 text-sm font-semibold transition-colors',
            swapSide === 'sell'
              ? 'bg-accent-red text-white'
              : 'text-text-secondary hover:text-text-primary bg-bg-tertiary'
          )}
        >
          Sell
        </button>
      </div>

      {/* Token pair display */}
      {selectedPair && (
        <div className="flex items-center justify-center gap-2 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">
            {swapSide === 'buy' ? 'SOL' : selectedPair.baseToken.symbol}
          </span>
          <ArrowUpDown size={14} className="text-text-muted" />
          <span className="font-medium text-text-primary">
            {swapSide === 'buy' ? selectedPair.baseToken.symbol : 'SOL'}
          </span>
        </div>
      )}

      {/* Input */}
      <div className="bg-bg-tertiary border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">You pay</span>
          {solBalance !== undefined && swapSide === 'buy' && (
            <button
              className="text-xs text-accent-blue hover:underline"
              onClick={() => setSwapInputAmount(Math.max(0, solBalance - 0.01).toFixed(4))}
            >
              Max: {solBalance.toFixed(4)} SOL
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={swapInputAmount}
            onChange={e => setSwapInputAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-xl font-mono text-text-primary outline-none placeholder-text-muted"
          />
          <div className="flex items-center gap-1.5 bg-bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm font-medium text-text-primary">
            {swapSide === 'buy' ? (
              <>
                <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="w-4 h-4 rounded-full" onError={e => (e.currentTarget.style.display = 'none')} />
                SOL
              </>
            ) : (
              <span>{selectedPair?.baseToken.symbol ?? 'Token'}</span>
            )}
            <ChevronDown size={12} className="text-text-muted" />
          </div>
        </div>
      </div>

      {/* Quick amounts */}
      {swapSide === 'buy' && (
        <div className="flex gap-2">
          {QUICK_AMOUNTS_SOL.map(a => (
            <button
              key={a}
              onClick={() => setSwapInputAmount(String(a))}
              className={clsx(
                'flex-1 py-1.5 text-xs rounded-lg border transition-colors',
                swapInputAmount === String(a)
                  ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                  : 'border-border text-text-muted hover:border-border-light hover:text-text-primary'
              )}
            >
              {a} SOL
            </button>
          ))}
        </div>
      )}

      {/* Output */}
      <div className="bg-bg-tertiary border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">You receive</span>
          {loading && <span className="text-xs text-text-muted animate-pulse">Fetching quote...</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xl font-mono text-text-primary">{outAmount}</span>
          <div className="flex items-center gap-1.5 bg-bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm font-medium text-text-primary">
            {swapSide === 'buy' ? (
              <span>{selectedPair?.baseToken.symbol ?? 'Token'}</span>
            ) : (
              <>
                <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="w-4 h-4 rounded-full" onError={e => (e.currentTarget.style.display = 'none')} />
                SOL
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quote details */}
      {quote && (
        <div className="bg-bg-tertiary border border-border rounded-xl p-3 space-y-1.5 text-xs animate-fade-in">
          <div className="flex justify-between">
            <span className="text-text-muted">Price Impact</span>
            <span className={clsx('font-mono', priceImpact > 3 ? 'text-accent-red' : priceImpact > 1 ? 'text-accent-yellow' : 'text-accent-green')}>
              {priceImpact.toFixed(3)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Slippage</span>
            <span className="font-mono text-text-secondary">{slippage}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Route</span>
            <span className="text-text-secondary">{quote.routePlan?.map(r => r.swapInfo.label).join(' → ') || 'Direct'}</span>
          </div>
        </div>
      )}

      {/* Settings */}
      <div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <Settings size={12} />
          Advanced Settings
          <ChevronDown size={10} className={clsx('transition-transform', showSettings && 'rotate-180')} />
        </button>

        {showSettings && (
          <div className="mt-3 space-y-3 animate-slide-in">
            <div>
              <div className="text-xs text-text-secondary mb-1.5">Slippage Tolerance</div>
              <div className="flex gap-1.5">
                {[0.1, 0.5, 1, 3].map(s => (
                  <button
                    key={s}
                    onClick={() => setSlippage(s)}
                    className={clsx(
                      'flex-1 py-1 text-xs rounded-lg border transition-colors',
                      slippage === s
                        ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                        : 'border-border text-text-muted hover:border-border-light'
                    )}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-secondary mb-1.5">Priority Fee</div>
              <div className="flex gap-1.5">
                {(['low', 'medium', 'high', 'ultra'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setPriorityFee(f)}
                    className={clsx(
                      'flex-1 py-1 text-xs rounded-lg border transition-colors capitalize',
                      priorityFee === f
                        ? 'bg-accent-purple/10 border-accent-purple text-accent-purple'
                        : 'border-border text-text-muted hover:border-border-light'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Swap button */}
      <button
        disabled={!publicKey || !quote || swapping || !selectedPair}
        onClick={executeSwap}
        className={clsx(
          'w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
          !publicKey
            ? 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-border'
            : !quote || !selectedPair
            ? 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-border'
            : swapSide === 'buy'
            ? 'bg-accent-green hover:bg-accent-green/90 text-bg-primary cursor-pointer shadow-lg glow-green'
            : 'bg-accent-red hover:bg-accent-red/90 text-white cursor-pointer shadow-lg glow-red'
        )}
      >
        {swapping ? (
          <>
            <Zap size={14} className="animate-spin" />
            Swapping...
          </>
        ) : !publicKey ? (
          'Connect Wallet'
        ) : !selectedPair ? (
          'Select a Token'
        ) : !quote ? (
          'Enter Amount'
        ) : (
          <>
            <Zap size={14} />
            {swapSide === 'buy' ? `Buy ${selectedPair.baseToken.symbol}` : `Sell ${selectedPair.baseToken.symbol}`}
          </>
        )}
      </button>
    </div>
  )
}
