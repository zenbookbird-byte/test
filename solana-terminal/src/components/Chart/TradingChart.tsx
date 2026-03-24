import { useState } from 'react'
import { useTerminalStore } from '../../store/terminalStore'
import type { TimeFrame } from '../../types'
import clsx from 'clsx'
import { Settings, Maximize2, Grid3X3 } from 'lucide-react'
import { TokenHeaderBar } from './TokenHeaderBar'
import { ChartToolbar } from './ChartToolbar'
import { ChartBottomTabs } from './ChartBottomTabs'

const TIMEFRAMES: TimeFrame[] = ['1m', '5m', '15m', '1h', '4h', '1d']

const TF_TO_DEXSCREENER: Record<TimeFrame, string> = {
  '1m':  '1',
  '5m':  '5',
  '15m': '15',
  '1h':  '60',
  '4h':  '240',
  '1d':  '1D',
}

export function TradingChart() {
  const { selectedPair, timeframe, setTimeframe } = useTerminalStore()
  const [showLog, setShowLog] = useState(false)

  const embedUrl = selectedPair
    ? `https://dexscreener.com/solana/${selectedPair.pairAddress}?embed=1&theme=dark&trades=0&info=0&chart=1&chartLeftToolbar=0&chartTheme=dark&chartStyle=0&chartType=usd&interval=${TF_TO_DEXSCREENER[timeframe]}`
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Token header bar */}
      <TokenHeaderBar pair={selectedPair} />

      {/* Chart area: toolbar + canvas */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left drawing toolbar */}
        <ChartToolbar />

        {/* Main chart column */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* Timeframe + chart controls */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-ax-border shrink-0 bg-ax-base">
            {/* Timeframes */}
            <div className="flex items-center gap-0.5">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={clsx(
                    'px-2 py-0.5 text-xs rounded font-mono transition-colors',
                    timeframe === tf
                      ? 'bg-ax-card text-text-primary border border-ax-bordl'
                      : 'text-text-muted hover:text-text-secondary hover:bg-ax-hover'
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-ax-border mx-1" />

            <button className="flex items-center gap-1 px-2 py-0.5 text-xs text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded transition-colors">
              <Grid3X3 size={10} />
            </button>

            <div className="ml-auto flex items-center gap-1.5 text-2xs text-text-muted">
              <button
                onClick={() => setShowLog(!showLog)}
                className={clsx('px-1.5 py-0.5 rounded border transition-colors text-2xs',
                  showLog ? 'border-green-DEFAULT/40 text-green-DEFAULT' : 'border-ax-border text-text-muted hover:text-text-secondary'
                )}>log</button>
              <span className="text-text-muted">auto</span>
              <button className="w-6 h-6 flex items-center justify-center hover:text-text-primary transition-colors">
                <Settings size={10} />
              </button>
              <button className="w-6 h-6 flex items-center justify-center hover:text-text-primary transition-colors">
                <Maximize2 size={10} />
              </button>
            </div>
          </div>

          {/* Chart canvas / embed */}
          <div className="relative flex-1 min-h-0">
            {embedUrl ? (
              <iframe
                key={selectedPair?.pairAddress}
                src={embedUrl}
                className="absolute inset-0 w-full h-full border-0"
                title="DexScreener Chart"
                allow="clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted gap-3">
                <div className="text-5xl opacity-10">📈</div>
                <div className="text-sm text-text-muted">Select a token to view chart</div>
                <div className="text-2xs text-text-dim">Search above or click a token in the scanner</div>
              </div>
            )}
          </div>

          {/* Bottom tabs */}
          <div className="border-t border-ax-border" style={{ height: 200 }}>
            <ChartBottomTabs pair={selectedPair} />
          </div>
        </div>
      </div>
    </div>
  )
}
