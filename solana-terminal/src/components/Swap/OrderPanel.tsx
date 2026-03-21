import { useState, useEffect, useCallback } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import {
  Flame, Zap, Shield, ChevronDown, AlertTriangle, CheckCircle2,
  BarChart2, RefreshCw, ArrowUpRight, ArrowDownRight,
  Edit3, Trash2, RotateCcw, Info
} from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import { getQuote, getSwapTransaction, SOL_MINT } from '../../services/jupiter'
import { useSOLBalance } from '../../hooks/useWalletTokens'
import type { JupiterQuote } from '../../services/jupiter'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const PRIORITY_FEES = { low: 1000, medium: 5000, high: 20000, ultra: 100000 }

// Mock live trades data
function useMockTrades(tab: 'dev' | 'tracked' | 'you') {
  const [trades, setTrades] = useState(() => generateTrades(tab))
  useEffect(() => {
    setTrades(generateTrades(tab))
    const iv = setInterval(() => setTrades(t => [generateOneTrade(tab), ...t.slice(0, 18)]), 2500)
    return () => clearInterval(iv)
  }, [tab])
  return trades
}

type TradeEntry = { id: number; amount: string; mc: string; trader: string; age: string; side: 'buy' | 'sell' }

function generateTrades(tab: string): TradeEntry[] {
  return Array.from({ length: 15 }, (_, i) => generateOneTrade(tab, i))
}

let _tid = 0
function generateOneTrade(_tab: string, offset = 0): TradeEntry {
  const names = ['nqn', 'TUN', 'zTB', 'm14', 'JVc', 'ysr', 'M14', '5wC', 'RTf', 'Do1', 'wRt', 'UGX', 'Avz', 'suy', 'cUg', 'K1e', 'BRo']
  const amounts = ['$0.09', '$0.89', '$1.34', '$2.07', '$3.13', '$5.75', '$7.43', '$8.15', '$8.89', '$14.13', '$24.72', '$36.98', '$41.44', '$42.88', '$44.45', '$72.43', '$84.14', '$93.66']
  const mcs = ['$30.2K', '$30.5K', '$30.8K', '$31.1K', '$31.2K', '$31.4K', '$31.6K', '$31.8K', '$32K', '$32.2K', '$32.3K', '$32.5K', '$32.8K', '$33K']
  const ages = ['5s', '6s', '8s', '9s', '12s', '13s']
  const r = Math.random()
  return {
    id: ++_tid + offset,
    amount: amounts[Math.floor(r * 100) % amounts.length],
    mc: mcs[Math.floor(r * 97) % mcs.length],
    trader: names[Math.floor(r * 89) % names.length],
    age: ages[Math.floor(r * 67) % ages.length],
    side: r > 0.45 ? 'buy' : 'sell',
  }
}

function mockHolderStats(addr?: string) {
  if (!addr) return { top10: 21.09, dev: 0, snipers: 2.15, insiders: 5.09, bundlers: 37.4, lpBurned: 100, holders: 254, proTraders: 146, tax: 1.25 }
  const n = addr.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return {
    top10: ((n * 7) % 40 + 10).toFixed(2),
    dev: ((n * 3) % 20).toFixed(2),
    snipers: ((n * 11) % 15 + 0.5).toFixed(2),
    insiders: ((n * 5) % 12 + 1).toFixed(2),
    bundlers: ((n * 13) % 50 + 5).toFixed(2),
    lpBurned: ((n * 17) % 100).toFixed(0),
    holders: (n % 800) + 50,
    proTraders: (n % 200) + 20,
    tax: ((n * 2) % 5 + 0.5).toFixed(2),
  }
}

type TradesTabId = 'dev' | 'tracked' | 'you'

function LiveTradesFeed({ pair }: { pair: import('../../types').TokenPair | null }) {
  const [tab, setTab] = useState<TradesTabId>('dev')
  const trades = useMockTrades(tab)

  return (
    <div className="flex flex-col overflow-hidden border-b border-ax-border" style={{ height: 220 }}>
      {/* Tab header */}
      <div className="flex items-center border-b border-ax-border shrink-0">
        {(['dev', 'tracked', 'you'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 py-1.5 text-2xs font-bold uppercase tracking-wider transition-colors border-b-2',
              tab === t ? 'text-green-DEFAULT border-green-DEFAULT' : 'text-text-muted border-transparent hover:text-text-secondary'
            )}>
            {t}
          </button>
        ))}
        <button className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary ml-1 shrink-0">
          <RefreshCw size={10} />
        </button>
      </div>

      {/* Columns header */}
      <div className="grid grid-cols-[1.2fr_1fr_60px_40px] text-2xs text-text-muted px-2 py-1 border-b border-ax-border/50 shrink-0">
        <span>Amount</span><span className="text-right">MC</span>
        <span className="text-right">Trader</span><span className="text-right">Age</span>
      </div>

      {/* Trades list */}
      <div className="flex-1 overflow-y-auto">
        {trades.map(tr => (
          <div key={tr.id}
            className={clsx('grid grid-cols-[1.2fr_1fr_60px_40px] items-center px-2 py-0.5 text-2xs hover:bg-ax-hover transition-colors cursor-pointer',
              tr.side === 'buy' ? 'border-l-2 border-l-green-DEFAULT/40' : 'border-l-2 border-l-red-DEFAULT/40'
            )}>
            <span className={clsx('font-mono font-semibold', tr.side === 'buy' ? 'pos' : 'neg')}>
              {tr.side === 'buy' ? <ArrowUpRight size={8} className="inline" /> : <ArrowDownRight size={8} className="inline" />}
              {tr.amount}
            </span>
            <span className="font-mono text-text-secondary text-right">{tr.mc}</span>
            <span className="font-mono text-text-primary text-right">{tr.trader}</span>
            <span className="text-text-muted text-right">{tr.age}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OrderPanel() {
  const {
    selectedPair,
    orderType, setOrderType,
    swapSide, setSwapSide,
    swapInputAmount, setSwapInputAmount,
    slippage, setSlippage,
    priorityFee, setPriorityFee,
    limitPrice, setLimitPrice,
    infernoMode, mevProtection,
    activePreset, setActivePreset,
  } = useTerminalStore()

  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const { data: solBalance } = useSOLBalance()

  const [quote, setQuote] = useState<JupiterQuote | null>(null)
  const [, setLoading] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTokenInfo, setShowTokenInfo] = useState(true)
  const [tpEnabled, setTpEnabled] = useState(false)
  const [slEnabled, setSlEnabled] = useState(false)
  const [tpValue, setTpValue] = useState('+50')
  const [slValue, setSlValue] = useState('-5')
  const [tpAmount, setTpAmount] = useState('100')
  const [slAmount, setSlAmount] = useState('100')

  // Axiom-style quick buy amounts
  const QUICK_BUY = ['0.01', '0.1', '1', '10']
  const QUICK_SELL = ['25', '50', '75', '100']

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

  const _outAmount = quote
    ? (parseInt(quote.outAmount) / Math.pow(10, swapSide === 'buy' ? 6 : 9)).toFixed(4)
    : '—'
  const _priceImpact = quote ? parseFloat(quote.priceImpactPct) * 100 : 0

  const stats = mockHolderStats(selectedPair?.baseToken.address)

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
        <div className="flex items-center gap-3 bg-ax-card border border-green-DEFAULT/30 rounded-xl px-4 py-3 shadow-2xl">
          <CheckCircle2 size={16} className="text-green-DEFAULT" />
          <div>
            <div className="text-xs font-medium text-text-primary">Swap submitted!</div>
            <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-accent hover:underline">View on Solscan ↗</a>
          </div>
        </div>
      ), { duration: 8000 })
      setSwapInputAmount('')
      setQuote(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Swap failed'
      toast.custom(() => (
        <div className="flex items-center gap-3 bg-ax-card border border-red-DEFAULT/30 rounded-xl px-4 py-3 shadow-2xl">
          <AlertTriangle size={16} className="text-red-DEFAULT" />
          <div className="text-xs text-text-primary">{msg.slice(0, 80)}</div>
        </div>
      ))
    } finally { setSwapping(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-ax-sidebar text-text-primary">
      {/* Live trades feed */}
      <LiveTradesFeed pair={selectedPair} />

      {/* Buy/Sell toggle */}
      <div className="flex p-2 gap-1.5 border-b border-ax-border shrink-0">
        <button
          onClick={() => setSwapSide('buy')}
          className={clsx('flex-1 py-2 text-xs font-bold rounded-lg transition-colors',
            swapSide === 'buy' ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card text-text-muted hover:text-text-primary border border-ax-border'
          )}
        >Buy</button>
        <button
          onClick={() => setSwapSide('sell')}
          className={clsx('flex-1 py-2 text-xs font-bold rounded-lg transition-colors',
            swapSide === 'sell' ? 'bg-red-DEFAULT text-white' : 'bg-ax-card text-text-muted hover:text-text-primary border border-ax-border'
          )}
        >Sell</button>
      </div>

      {/* Order type: Market / Limit / Adv. */}
      <div className="flex items-center border-b border-ax-border px-2 shrink-0">
        {([['market', 'Market'], ['limit', 'Limit'], ['dca', 'Adv.']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setOrderType(id)}
            className={clsx('px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
              orderType === id ? 'text-text-primary border-text-secondary' : 'text-text-muted border-transparent hover:text-text-secondary'
            )}>
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-2xs text-text-muted pr-1">
          <span>1</span><span className="text-ax-bordl">|</span><span>0</span>
        </div>
      </div>

      {/* Inferno mode quick-buy */}
      {infernoMode && swapSide === 'buy' && (
        <div className="p-2 border-b border-orange-500/20 bg-orange-950/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Flame size={11} className="text-orange-400" />
            <span className="text-xs font-bold text-orange-400">INFERNO MODE</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[0.1, 0.5, 1, 5].map(amt => (
              <button key={amt} onClick={() => setSwapInputAmount(String(amt))}
                className="py-1.5 text-xs font-bold rounded bg-gradient-to-b from-orange-500 to-red-600 text-white hover:from-orange-400 hover:to-red-500 transition-all active:scale-95">
                {amt}◎
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Amount input + quick presets */}
      <div className="p-2 space-y-2 shrink-0">
        {/* Amount display */}
        <div className="ax-input p-2.5 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-2xs text-text-muted">AMOUNT</span>
            {solBalance !== undefined && swapSide === 'buy' && (
              <button className="text-2xs text-blue-accent hover:underline"
                onClick={() => setSwapInputAmount(Math.max(0, solBalance - 0.01).toFixed(4))}>
                {solBalance.toFixed(3)} ◎
              </button>
            )}
          </div>
          <input
            type="number"
            value={swapInputAmount}
            onChange={e => setSwapInputAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-transparent text-lg font-mono text-text-primary outline-none placeholder-text-muted"
          />
        </div>

        {/* Quick presets row */}
        <div className="flex gap-1 items-center">
          {(swapSide === 'buy' ? QUICK_BUY : QUICK_SELL).map(a => (
            <button key={a}
              onClick={() => setSwapInputAmount(a)}
              className={clsx('flex-1 py-1 text-2xs rounded border font-mono transition-colors',
                swapInputAmount === a
                  ? 'border-green-DEFAULT/60 text-green-DEFAULT bg-green-dim'
                  : 'border-ax-border text-text-muted hover:border-ax-bordl hover:text-text-secondary'
              )}>
              {swapSide === 'buy' ? a : `${a}%`}
            </button>
          ))}
          <button className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary shrink-0">
            <Edit3 size={10} />
          </button>
        </div>

        {/* Slippage row */}
        <div className="flex items-center gap-1 text-2xs">
          {['2.5%', '0.001', '0.001'].map((v, i) => (
            <button key={i}
              className={clsx('px-2 py-0.5 rounded border font-mono transition-colors',
                i === 0 ? 'border-green-DEFAULT/40 text-green-DEFAULT bg-green-dim' : 'border-ax-border text-text-muted hover:border-ax-bordl'
              )}>
              {v}
            </button>
          ))}
          <label className="flex items-center gap-1 text-text-muted ml-auto">
            <div className="relative w-6 h-3 rounded-full bg-green-DEFAULT cursor-pointer">
              <div className="absolute right-0.5 top-0.5 w-2 h-2 rounded-full bg-white" />
            </div>
            On
          </label>
        </div>

        {/* Limit order fields */}
        {orderType === 'limit' && (
          <div className="ax-input p-2.5 rounded-lg">
            <div className="text-2xs text-text-muted mb-1">Limit Price (USD)</div>
            <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
              placeholder={selectedPair?.priceUsd ?? '0.00'}
              className="w-full bg-transparent text-sm font-mono text-text-primary outline-none placeholder-text-muted" />
          </div>
        )}
      </div>

      {/* Advanced Trading Strategy (TP/SL) */}
      <div className="px-2 pb-2 space-y-2 border-b border-ax-border">
        <button className="flex items-center gap-1.5 text-2xs text-text-muted hover:text-text-primary transition-colors w-full">
          <BarChart2 size={10} className="text-blue-accent" />
          <span className="text-blue-accent font-medium">Advanced Trading Strategy</span>
        </button>

        {/* TP row */}
        <div className="flex items-center gap-1.5">
          <div className={clsx('flex items-center gap-1 w-5 h-5 rounded shrink-0 cursor-pointer',
            tpEnabled ? 'text-green-DEFAULT' : 'text-text-muted')}
            onClick={() => setTpEnabled(!tpEnabled)}>
            <ArrowUpRight size={12} />
          </div>
          <span className="text-2xs text-text-muted w-3">TP</span>
          <input type="text" value={tpValue} onChange={e => setTpValue(e.target.value)}
            className="w-12 ax-input px-1.5 py-0.5 text-2xs font-mono text-green-DEFAULT rounded text-center" />
          <span className="text-2xs text-text-muted">%</span>
          <span className="text-2xs text-text-muted ml-auto">Amount</span>
          <input type="text" value={tpAmount} onChange={e => setTpAmount(e.target.value)}
            className="w-10 ax-input px-1.5 py-0.5 text-2xs font-mono text-text-primary rounded text-center" />
          <span className="text-2xs text-text-muted">%</span>
          <button className="text-text-muted hover:text-red-DEFAULT transition-colors"><Trash2 size={10} /></button>
        </div>

        {/* SL row */}
        <div className="flex items-center gap-1.5">
          <div className={clsx('flex items-center gap-1 w-5 h-5 rounded shrink-0 cursor-pointer',
            slEnabled ? 'text-red-DEFAULT' : 'text-text-muted')}
            onClick={() => setSlEnabled(!slEnabled)}>
            <ArrowDownRight size={12} />
          </div>
          <span className="text-2xs text-text-muted w-3">SL</span>
          <input type="text" value={slValue} onChange={e => setSlValue(e.target.value)}
            className="w-12 ax-input px-1.5 py-0.5 text-2xs font-mono text-red-DEFAULT rounded text-center" />
          <span className="text-2xs text-text-muted">%</span>
          <span className="text-2xs text-text-muted ml-auto">Amount</span>
          <input type="text" value={slAmount} onChange={e => setSlAmount(e.target.value)}
            className="w-10 ax-input px-1.5 py-0.5 text-2xs font-mono text-text-primary rounded text-center" />
          <span className="text-2xs text-text-muted">%</span>
          <button className="text-text-muted hover:text-red-DEFAULT transition-colors"><Trash2 size={10} /></button>
        </div>

        <button className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-primary transition-colors">
          <span className="w-4 h-4 rounded border border-ax-bordl flex items-center justify-center text-xs">+</span>
          Add
        </button>
      </div>

      {/* Execute button */}
      <div className="p-2 shrink-0">
        <button
          disabled={!publicKey || !selectedPair || swapping || (orderType === 'market' && !quote)}
          onClick={executeSwap}
          className={clsx(
            'w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2',
            !publicKey || !selectedPair || (orderType === 'market' && !quote)
              ? 'bg-ax-card text-text-muted border border-ax-border cursor-not-allowed'
              : swapSide === 'buy'
              ? 'bg-green-DEFAULT hover:bg-green-light text-ax-base cursor-pointer'
              : 'bg-red-DEFAULT hover:bg-red-DEFAULT/90 text-white cursor-pointer'
          )}
        >
          {swapping ? (<><Zap size={14} className="animate-spin" /> Executing...</>) :
            !publicKey ? 'Connect Wallet' :
            !selectedPair ? 'Select a Token' :
            orderType === 'market' && !quote ? 'Enter Amount' :
            swapSide === 'buy'
              ? `Buy ${selectedPair?.baseToken.symbol ?? ''}`
              : `Sell ${selectedPair?.baseToken.symbol ?? ''}`
          }
        </button>
      </div>

      {/* Position stats */}
      <div className="grid grid-cols-4 border-b border-ax-border px-2 py-2 shrink-0">
        {[
          { label: 'Bought', value: '0', icon: '≡' },
          { label: 'Sold',   value: '0', icon: '≡' },
          { label: 'Holding', value: '0', icon: '≡' },
          { label: 'PnL', value: '+0(+0%)', icon: '≡', pos: true },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className="text-2xs text-text-muted">{s.label}</div>
            <div className={clsx('text-2xs font-mono font-medium', s.pos ? 'pos' : 'text-text-primary')}>
              {s.icon} {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Preset buttons */}
      <div className="flex gap-1 px-2 py-2 border-b border-ax-border shrink-0">
        {[1, 2, 3].map(p => (
          <button key={p} onClick={() => setActivePreset(p)}
            className={clsx('flex-1 py-1 text-2xs font-bold rounded transition-colors',
              activePreset === p ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card border border-ax-border text-text-muted hover:text-text-primary'
            )}>
            PRESET {p}
          </button>
        ))}
      </div>

      {/* Token Info panel */}
      <div className="shrink-0">
        <button onClick={() => setShowTokenInfo(!showTokenInfo)}
          className="flex items-center justify-between w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors border-b border-ax-border">
          <div className="flex items-center gap-1.5">
            <Info size={11} className="text-blue-accent" />
            Token Info
          </div>
          <ChevronDown size={11} className={clsx('transition-transform', showTokenInfo && 'rotate-180')} />
        </button>

        {showTokenInfo && (
          <div className="px-3 pb-3 space-y-3 bg-ax-sidebar">
            {/* Tax */}
            <div className="flex justify-end mt-2">
              <div className="text-right">
                <div className="text-lg font-bold font-mono text-text-primary">{stats.tax}%</div>
                <div className="text-2xs text-text-muted">Tax %</div>
              </div>
            </div>

            {/* Top row stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Top 10 H.', value: `${stats.top10}%`, color: 'text-red-DEFAULT' },
                { label: 'Dev H.',    value: `${stats.dev}%`,   color: 'text-text-primary' },
                { label: 'Snipers H.',value: `${stats.snipers}%`, color: 'text-text-primary' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className={clsx('text-sm font-bold font-mono', s.color)}>{s.value}</div>
                  <div className="text-2xs text-text-muted">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Mid row stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Insiders',  value: `${stats.insiders}%`,  color: 'text-orange-400' },
                { label: 'Bundlers',  value: `${stats.bundlers}%`,  color: 'text-orange-400' },
                { label: 'LP Burned', value: `${stats.lpBurned}%`,  color: 'pos' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className={clsx('text-sm font-bold font-mono', s.color)}>{s.value}</div>
                  <div className="text-2xs text-text-muted">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Bottom row stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Holders',     value: String(stats.holders) },
                { label: 'Pro Traders', value: String(stats.proTraders) },
                { label: 'Paid',        value: 'Paid', badge: true },
              ].map(s => (
                <div key={s.label} className="text-center">
                  {s.badge
                    ? <span className="badge badge-green text-xs px-2 py-0.5">Paid</span>
                    : <div className="text-sm font-bold font-mono text-text-primary">{s.value}</div>
                  }
                  <div className="text-2xs text-text-muted">{s.label}</div>
                </div>
              ))}
            </div>

            {/* CA */}
            {selectedPair && (
              <div className="flex items-center gap-1.5 bg-ax-card border border-ax-border rounded-lg px-2 py-1.5">
                <span className="text-2xs text-text-muted">CA:</span>
                <span className="text-2xs font-mono text-text-secondary truncate flex-1">
                  {selectedPair.baseToken.address.slice(0, 8)}..{selectedPair.baseToken.address.slice(-4)}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(selectedPair.baseToken.address)}
                  className="text-text-muted hover:text-green-DEFAULT transition-colors shrink-0">
                  <RotateCcw size={9} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Advanced settings */}
      <div className="px-2 pb-2">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-secondary transition-colors mt-1">
          <ChevronDown size={10} className={clsx('transition-transform', showAdvanced && 'rotate-180')} />
          Advanced
        </button>
        {showAdvanced && (
          <div className="space-y-2 mt-2">
            <div>
              <div className="text-2xs text-text-muted mb-1">Slippage</div>
              <div className="flex gap-1">
                {[0.1, 0.5, 1, 3, 10].map(s => (
                  <button key={s} onClick={() => setSlippage(s)}
                    className={clsx('flex-1 py-0.5 text-2xs rounded border font-mono transition-colors',
                      slippage === s ? 'border-green-DEFAULT/40 text-green-DEFAULT bg-green-dim' : 'border-ax-border text-text-muted hover:border-ax-bordl'
                    )}>{s}%</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-2xs text-text-muted mb-1">Priority Fee</div>
              <div className="flex gap-1">
                {(['low', 'medium', 'high', 'ultra'] as const).map(f => (
                  <button key={f} onClick={() => setPriorityFee(f)}
                    className={clsx('flex-1 py-0.5 text-2xs rounded border capitalize transition-colors',
                      priorityFee === f ? 'border-blue-accent/40 text-blue-accent bg-blue-accent/5' : 'border-ax-border text-text-muted hover:border-ax-bordl'
                    )}>{f}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between text-2xs">
              <span className="text-text-muted">MEV Protection</span>
              <span className={clsx('flex items-center gap-1', mevProtection ? 'text-green-DEFAULT' : 'text-text-muted')}>
                <Shield size={10} />{mevProtection ? 'Active' : 'Off'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
