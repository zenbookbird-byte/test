import { useState, useEffect, useCallback } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import { Flame, Zap, Shield, ChevronDown, AlertTriangle, CheckCircle2, ArrowUpDown, Clock, BarChart2 } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getQuote, getSwapTransaction, SOL_MINT } from '../../services/jupiter'
import { useSOLBalance } from '../../hooks/useWalletTokens'
import type { JupiterQuote } from '../../services/jupiter'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const PRIORITY_FEES = { low: 1000, medium: 5000, high: 20000, ultra: 100000 }
const BUY_PRESETS = [0.1, 0.5, 1, 5]
const SELL_PRESETS = [25, 50, 75, 100]

export function OrderPanel() {
  const {
    selectedPair,
    orderType, setOrderType,
    swapSide, setSwapSide,
    swapInputAmount, setSwapInputAmount,
    slippage, setSlippage,
    priorityFee, setPriorityFee,
    limitPrice, setLimitPrice,
    stopLoss, setStopLoss,
    takeProfit, setTakeProfit,
    infernoMode, mevProtection,
  } = useTerminalStore()

  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const { data: solBalance } = useSOLBalance()

  const [quote, setQuote] = useState<JupiterQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const tokenMint = selectedPair?.baseToken.address
  const inputMint = swapSide === 'buy' ? SOL_MINT : (tokenMint ?? SOL_MINT)
  const outputMint = swapSide === 'buy' ? (tokenMint ?? SOL_MINT) : SOL_MINT

  const fetchQuote = useCallback(async () => {
    if (!swapInputAmount || !tokenMint || parseFloat(swapInputAmount) <= 0 || orderType !== 'market') {
      setQuote(null); return
    }
    setLoading(true)
    try {
      const decimals = swapSide === 'buy' ? 9 : 6
      const amount = Math.floor(parseFloat(swapInputAmount) * Math.pow(10, decimals))
      const q = await getQuote(inputMint, outputMint, amount.toString(), Math.floor(slippage * 100))
      setQuote(q)
    } catch { setQuote(null) }
    finally { setLoading(false) }
  }, [swapInputAmount, tokenMint, inputMint, outputMint, slippage, orderType, swapSide])

  useEffect(() => {
    const t = setTimeout(fetchQuote, 400)
    return () => clearTimeout(t)
  }, [fetchQuote])

  const outAmount = quote
    ? (parseInt(quote.outAmount) / Math.pow(10, swapSide === 'buy' ? 6 : 9)).toFixed(4)
    : '—'
  const priceImpact = quote ? parseFloat(quote.priceImpactPct) * 100 : 0

  async function executeSwap() {
    if (!quote || !publicKey || !signTransaction) { toast.error('Connect wallet'); return }
    setSwapping(true)
    try {
      const swapTx = await getSwapTransaction(quote, publicKey.toBase58(), PRIORITY_FEES[priorityFee])
      if (!swapTx) throw new Error('Failed to build transaction')
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTx, 'base64'))
      const signed = await signTransaction(tx)
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 })
      toast.custom(() => (
        <div className="flex items-center gap-3 bg-bg-card border border-accent-green/30 rounded-xl px-4 py-3 shadow-2xl">
          <CheckCircle2 size={16} className="text-accent-green" />
          <div>
            <div className="text-xs font-medium text-text-primary">Swap submitted!</div>
            <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-DEFAULT hover:underline">View on Solscan ↗</a>
          </div>
        </div>
      ), { duration: 8000 })
      setSwapInputAmount('')
      setQuote(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Swap failed'
      toast.custom(() => (
        <div className="flex items-center gap-3 bg-bg-card border border-accent-red/30 rounded-xl px-4 py-3 shadow-2xl">
          <AlertTriangle size={16} className="text-accent-red" />
          <div className="text-xs text-text-primary">{msg.slice(0, 80)}</div>
        </div>
      ))
    } finally { setSwapping(false) }
  }

  async function infernoTrade(amount: number) {
    if (!publicKey || !tokenMint) return
    setSwapInputAmount(String(amount))
    // Will trigger quote fetch, then auto-submit on next render
    toast.custom(() => (
      <div className="flex items-center gap-2 bg-orange-950/80 border border-orange-500/40 rounded-xl px-3 py-2">
        <Flame size={14} className="text-orange-400" />
        <span className="text-xs text-orange-300">Inferno: {amount} SOL buy queued</span>
      </div>
    ), { duration: 3000 })
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Buy/Sell + Order type */}
      <div className="p-3 border-b border-border space-y-2 shrink-0">
        {/* Buy / Sell */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            onClick={() => setSwapSide('buy')}
            className={clsx('flex-1 py-2 text-xs font-bold transition-colors',
              swapSide === 'buy' ? 'bg-accent-green text-bg-base' : 'text-text-muted hover:text-text-primary bg-bg-tertiary'
            )}
          >BUY</button>
          <button
            onClick={() => setSwapSide('sell')}
            className={clsx('flex-1 py-2 text-xs font-bold transition-colors',
              swapSide === 'sell' ? 'bg-accent-red text-white' : 'text-text-muted hover:text-text-primary bg-bg-tertiary'
            )}
          >SELL</button>
        </div>

        {/* Order type tabs */}
        <div className="flex gap-1">
          {([
            { id: 'market', label: 'Market', icon: Zap },
            { id: 'limit',  label: 'Limit',  icon: Clock },
            { id: 'dca',    label: 'DCA',    icon: BarChart2 },
          ] as const).map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setOrderType(tab.id)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1 py-1 text-xs rounded-md border transition-colors',
                  orderType === tab.id
                    ? 'bg-cyan/10 border-cyan/30 text-cyan-DEFAULT'
                    : 'border-border text-text-muted hover:text-text-secondary bg-bg-tertiary'
                )}
              >
                <Icon size={10} />{tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Inferno mode quick-buy */}
      {infernoMode && swapSide === 'buy' && (
        <div className="p-3 border-b border-orange-500/20 bg-orange-950/20">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame size={12} className="text-orange-400" />
            <span className="text-xs font-bold text-orange-400">INFERNO MODE</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[0.1, 0.5, 1, 5].map(amt => (
              <button
                key={amt}
                onClick={() => infernoTrade(amt)}
                className="py-2 text-xs font-bold rounded-lg bg-gradient-to-b from-orange-500 to-red-600 text-white hover:from-orange-400 hover:to-red-500 transition-all shadow-lg active:scale-95"
              >
                {amt}◎
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-3 space-y-2">
        {/* Amount input */}
        <div className="bg-bg-tertiary border border-border rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-muted">
              {swapSide === 'buy' ? 'Pay (SOL)' : `Sell (${selectedPair?.baseToken.symbol ?? 'Token'})`}
            </span>
            {solBalance !== undefined && swapSide === 'buy' && (
              <button
                className="text-xs text-cyan-DEFAULT hover:underline"
                onClick={() => setSwapInputAmount(Math.max(0, solBalance - 0.01).toFixed(4))}
              >
                Bal: {solBalance.toFixed(3)} ◎
              </button>
            )}
          </div>
          <input
            type="number"
            value={swapInputAmount}
            onChange={e => setSwapInputAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-lg font-mono text-text-primary outline-none placeholder-text-muted"
          />
        </div>

        {/* Quick presets */}
        <div className="flex gap-1">
          {(swapSide === 'buy' ? BUY_PRESETS : SELL_PRESETS).map(a => (
            <button
              key={a}
              onClick={() => setSwapInputAmount(swapSide === 'buy' ? String(a) : String(a))}
              className={clsx(
                'flex-1 py-1 text-xs rounded border transition-colors font-mono',
                swapInputAmount === String(a)
                  ? 'border-cyan/40 text-cyan-DEFAULT bg-cyan/5'
                  : 'border-border text-text-muted hover:border-border-light hover:text-text-secondary'
              )}
            >
              {swapSide === 'buy' ? `${a}◎` : `${a}%`}
            </button>
          ))}
        </div>

        {/* Limit order fields */}
        {orderType === 'limit' && (
          <div className="space-y-2 animate-slide-in">
            <div className="bg-bg-tertiary border border-border rounded-lg p-2.5">
              <div className="text-xs text-text-muted mb-1">Limit Price (USD)</div>
              <input
                type="number"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder={selectedPair?.priceUsd ?? '0.00'}
                className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-bg-tertiary border border-accent-red/20 rounded-lg p-2">
                <div className="text-xs text-accent-red mb-1">Stop Loss %</div>
                <input
                  type="number"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  placeholder="-15"
                  className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted"
                />
              </div>
              <div className="bg-bg-tertiary border border-accent-green/20 rounded-lg p-2">
                <div className="text-xs text-accent-green mb-1">Take Profit %</div>
                <input
                  type="number"
                  value={takeProfit}
                  onChange={e => setTakeProfit(e.target.value)}
                  placeholder="+50"
                  className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted"
                />
              </div>
            </div>
          </div>
        )}

        {/* DCA info */}
        {orderType === 'dca' && (
          <div className="bg-cyan/5 border border-cyan/20 rounded-lg p-3 text-xs text-text-secondary animate-slide-in">
            <div className="text-cyan-DEFAULT font-medium mb-1">Dollar Cost Averaging</div>
            <div>DCA splits your order into equal parts executed over time to reduce price impact.</div>
            <div className="mt-2 text-text-muted">Coming soon — use Jupiter DCA for now ↗</div>
          </div>
        )}

        {/* You receive */}
        {orderType === 'market' && (
          <div className="bg-bg-tertiary border border-border rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-text-muted">
                Receive ({swapSide === 'buy' ? selectedPair?.baseToken.symbol ?? 'Token' : 'SOL'})
              </span>
              {loading && <span className="text-xs text-text-muted animate-pulse">quoting...</span>}
            </div>
            <div className="text-lg font-mono text-text-primary">{outAmount}</div>
          </div>
        )}

        {/* Quote details */}
        {quote && orderType === 'market' && (
          <div className="text-xs space-y-1 animate-fade-in">
            <div className="flex justify-between">
              <span className="text-text-muted">Price Impact</span>
              <span className={clsx('font-mono', priceImpact > 5 ? 'text-accent-red' : priceImpact > 1 ? 'text-accent-yellow' : 'text-accent-green')}>
                {priceImpact.toFixed(3)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Route</span>
              <span className="text-text-secondary truncate max-w-[120px]">
                {quote.routePlan?.[0]?.swapInfo?.label ?? 'Direct'}
              </span>
            </div>
          </div>
        )}

        {/* Advanced settings */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <ChevronDown size={10} className={clsx('transition-transform', showAdvanced && 'rotate-180')} />
          Advanced
        </button>

        {showAdvanced && (
          <div className="space-y-3 animate-slide-in">
            <div>
              <div className="text-xs text-text-muted mb-1.5">Slippage</div>
              <div className="flex gap-1">
                {[0.1, 0.5, 1, 3, 10].map(s => (
                  <button key={s} onClick={() => setSlippage(s)}
                    className={clsx('flex-1 py-0.5 text-xs rounded border transition-colors font-mono',
                      slippage === s ? 'border-cyan/40 text-cyan-DEFAULT bg-cyan/5' : 'border-border text-text-muted hover:border-border-light'
                    )}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1.5">Priority Fee</div>
              <div className="flex gap-1">
                {(['low', 'medium', 'high', 'ultra'] as const).map(f => (
                  <button key={f} onClick={() => setPriorityFee(f)}
                    className={clsx('flex-1 py-0.5 text-xs rounded border transition-colors capitalize',
                      priorityFee === f ? 'border-accent-purple/40 text-accent-purple bg-accent-purple/5' : 'border-border text-text-muted hover:border-border-light'
                    )}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {/* MEV indicator */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">MEV Protection</span>
              <span className={clsx('flex items-center gap-1', mevProtection ? 'text-accent-green' : 'text-text-muted')}>
                <Shield size={10} />
                {mevProtection ? 'Active' : 'Off'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Execute button */}
      <div className="p-3 mt-auto border-t border-border shrink-0">
        <button
          disabled={!publicKey || !selectedPair || swapping || (orderType === 'market' && !quote)}
          onClick={executeSwap}
          className={clsx(
            'w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 relative overflow-hidden',
            !publicKey
              ? 'bg-bg-tertiary text-text-muted border border-border cursor-not-allowed'
              : !selectedPair
              ? 'bg-bg-tertiary text-text-muted border border-border cursor-not-allowed'
              : orderType === 'market' && !quote
              ? 'bg-bg-tertiary text-text-muted border border-border cursor-not-allowed'
              : swapSide === 'buy'
              ? 'bg-accent-green hover:bg-accent-green/90 text-bg-base cursor-pointer glow-green'
              : 'bg-accent-red hover:bg-accent-red/90 text-white cursor-pointer glow-red'
          )}
        >
          {swapping ? (
            <><Zap size={14} className="animate-spin" /> Executing...</>
          ) : !publicKey ? 'Connect Wallet' :
            !selectedPair ? 'Select a Token' :
            orderType === 'limit' ? `Place ${swapSide === 'buy' ? 'Buy' : 'Sell'} Limit` :
            orderType === 'dca' ? 'Start DCA' :
            !quote ? 'Enter Amount' : (
              <>{swapSide === 'buy' ? '▲ Buy' : '▼ Sell'} {selectedPair.baseToken.symbol}</>
            )
          }
        </button>

        {selectedPair && orderType === 'market' && (
          <div className="flex justify-between mt-2 text-xs text-text-muted">
            <span>Slippage: {slippage}%</span>
            <span>{mevProtection ? '🛡 MEV Protected' : 'No MEV protection'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
