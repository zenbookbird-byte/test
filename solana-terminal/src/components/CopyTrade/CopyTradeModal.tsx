import { useState } from 'react'
import { X, Zap, AlertTriangle } from 'lucide-react'
import type { Trader } from './traderData'
import { shortAddr, AVATAR_COLORS } from './traderData'
import clsx from 'clsx'

interface Props {
  trader: Trader
  onClose: () => void
}

export function CopyTradeModal({ trader, onClose }: Props) {
  const [mode, setMode] = useState<'fixed' | 'proportional'>('fixed')
  const [amount, setAmount] = useState('0.5')
  const [maxBuy, setMaxBuy] = useState('2')
  const [stopLoss, setStopLoss] = useState('50')
  const [takeProfit, setTakeProfit] = useState('200')
  const [autoSell, setAutoSell] = useState(true)
  const [skipDegen, setSkipDegen] = useState(false)
  const [slippage, setSlippage] = useState('10')

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-ax-panel border border-ax-border rounded-2xl shadow-2xl overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ax-border">
          <div className="flex items-center gap-3">
            <div className={clsx('w-9 h-9 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-sm font-bold text-white', AVATAR_COLORS[trader.avatarSeed])}>
              {(trader.name ?? trader.address)[0].toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold text-text-primary">{trader.name ?? shortAddr(trader.address)}</div>
              <div className="text-2xs text-text-muted">Win Rate: <span className="text-green-DEFAULT">{trader.winRate7d}%</span> · 7D PnL: <span className="text-green-DEFAULT">+{trader.pnlPct7d}%</span></div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded-lg transition-colors">
            <X size={13} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Mode */}
          <div>
            <div className="text-xs text-text-muted mb-2 font-medium">Copy Mode</div>
            <div className="flex rounded-lg overflow-hidden border border-ax-border">
              <button onClick={() => setMode('fixed')} className={clsx('flex-1 py-2 text-xs font-semibold transition-colors', mode === 'fixed' ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card text-text-muted hover:text-text-primary')}>
                Fixed Amount
              </button>
              <button onClick={() => setMode('proportional')} className={clsx('flex-1 py-2 text-xs font-semibold transition-colors', mode === 'proportional' ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-card text-text-muted hover:text-text-primary')}>
                Proportional
              </button>
            </div>
          </div>

          {/* Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div className="ax-input p-3 rounded-xl">
              <div className="text-2xs text-text-muted mb-1.5">
                {mode === 'fixed' ? 'Copy Amount (SOL)' : 'Portfolio %'}
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-mono text-text-primary outline-none" />
                <span className="text-xs text-text-muted font-medium">{mode === 'fixed' ? 'SOL' : '%'}</span>
              </div>
            </div>
            <div className="ax-input p-3 rounded-xl">
              <div className="text-2xs text-text-muted mb-1.5">Max Buy (SOL)</div>
              <div className="flex items-center gap-1.5">
                <input type="number" value={maxBuy} onChange={e => setMaxBuy(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-mono text-text-primary outline-none" />
                <span className="text-xs text-text-muted">SOL</span>
              </div>
            </div>
          </div>

          {/* Stop Loss / Take Profit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="ax-input p-3 rounded-xl">
              <div className="text-2xs text-text-muted mb-1.5">Stop Loss</div>
              <div className="flex items-center gap-1.5">
                <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-mono text-red-DEFAULT outline-none" />
                <span className="text-xs text-text-muted">%</span>
              </div>
            </div>
            <div className="ax-input p-3 rounded-xl">
              <div className="text-2xs text-text-muted mb-1.5">Take Profit</div>
              <div className="flex items-center gap-1.5">
                <input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-mono text-green-DEFAULT outline-none" />
                <span className="text-xs text-text-muted">%</span>
              </div>
            </div>
          </div>

          {/* Slippage */}
          <div className="ax-input p-3 rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-2xs text-text-muted">Slippage Tolerance</span>
              <div className="flex gap-1">
                {['5', '10', '15', '20'].map(v => (
                  <button key={v} onClick={() => setSlippage(v)}
                    className={clsx('text-2xs px-1.5 py-0.5 rounded transition-colors', slippage === v ? 'bg-green-DEFAULT text-ax-base' : 'bg-ax-border text-text-muted hover:text-text-primary')}>
                    {v}%
                  </button>
                ))}
              </div>
            </div>
            <input type="number" value={slippage} onChange={e => setSlippage(e.target.value)}
              className="w-full bg-transparent text-sm font-mono text-text-primary outline-none" />
          </div>

          {/* Toggles */}
          <div className="space-y-2.5">
            {[
              { label: 'Auto Sell on Copy Sell', sub: 'Automatically sell when trader sells', val: autoSell, set: setAutoSell },
              { label: 'Skip Degen Tokens', sub: 'Skip tokens with honeypot/blacklist flags', val: skipDegen, set: setSkipDegen },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between bg-ax-card border border-ax-border rounded-xl px-3 py-2.5">
                <div>
                  <div className="text-xs font-medium text-text-primary">{item.label}</div>
                  <div className="text-2xs text-text-muted">{item.sub}</div>
                </div>
                <button onClick={() => item.set(!item.val)}
                  className={clsx('w-10 h-5 rounded-full transition-colors relative shrink-0', item.val ? 'bg-green-DEFAULT' : 'bg-ax-border')}>
                  <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', item.val ? 'left-5' : 'left-0.5')} />
                </button>
              </div>
            ))}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 bg-yellow-DEFAULT/10 border border-yellow-DEFAULT/20 rounded-xl p-3">
            <AlertTriangle size={13} className="text-yellow-DEFAULT shrink-0 mt-0.5" />
            <p className="text-2xs text-yellow-DEFAULT">
              Copy trading involves risk. Past performance does not guarantee future results. Never invest more than you can afford to lose.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-ax-border">
          <button className="w-full btn-buy py-3 text-sm font-bold flex items-center justify-center gap-2 rounded-xl">
            <Zap size={14} />
            Start Copy Trading
          </button>
          <p className="text-center text-2xs text-text-muted mt-2">
            ~{parseFloat(amount || '0').toFixed(2)} SOL per trade · Max {parseFloat(maxBuy || '0').toFixed(2)} SOL
          </p>
        </div>
      </div>
    </div>
  )
}
