import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts'
import { useTerminalStore } from '../../store/terminalStore'
import { getOHLCV } from '../../services/dexscreener'
import type { TimeFrame } from '../../types'
import clsx from 'clsx'
import { RefreshCw, Settings, Maximize2, Grid3X3 } from 'lucide-react'
import { TokenHeaderBar } from './TokenHeaderBar'
import { ChartToolbar } from './ChartToolbar'
import { ChartBottomTabs } from './ChartBottomTabs'

const TF_MAP: Record<TimeFrame, { unit: string; agg: number }> = {
  '1m':  { unit: 'minute', agg: 1 },
  '5m':  { unit: 'minute', agg: 5 },
  '15m': { unit: 'minute', agg: 15 },
  '1h':  { unit: 'hour',   agg: 1 },
  '4h':  { unit: 'hour',   agg: 4 },
  '1d':  { unit: 'day',    agg: 1 },
}

const TIMEFRAMES: TimeFrame[] = ['1m', '5m', '15m', '1h', '4h', '1d']

type ChartType = 'candle' | 'bar' | 'area'

export function TradingChart() {
  const { selectedPair, timeframe, setTimeframe } = useTerminalStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)
  const [_chartType] = useState<ChartType>('candle')
  const [showLog, setShowLog] = useState(false)
  const loadRef = useRef(false)

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#080a0e' },
        textColor: '#4a5168',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1e2235' },
        horzLines: { color: '#1e2235' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#16c78444', labelBackgroundColor: '#111420' },
        horzLine: { color: '#16c78444', labelBackgroundColor: '#111420' },
      },
      rightPriceScale: {
        borderColor: '#1e2235',
        textColor: '#4a5168',
      },
      timeScale: {
        borderColor: '#1e2235',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        '#16c784',
      downColor:      '#ea3943',
      borderUpColor:  '#16c784',
      borderDownColor:'#ea3943',
      wickUpColor:    '#16c784',
      wickDownColor:  '#ea3943',
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    volumeRef.current = volumeSeries

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!selectedPair || !candleRef.current || loadRef.current) return
    loadRef.current = true
    setLoading(true)
    setNoData(false)

    try {
      const tf = TF_MAP[timeframe]
      const bars = await getOHLCV(selectedPair.pairAddress, tf.unit, tf.agg, 300)

      if (!bars.length) {
        setNoData(true)
        candleRef.current?.setData([])
        volumeRef.current?.setData([])
        return
      }

      const candles: CandlestickData<UTCTimestamp>[] = bars.map(b => ({
        time: b.time as UTCTimestamp,
        open:  b.open,
        high:  b.high,
        low:   b.low,
        close: b.close,
      }))

      const volumes: HistogramData<UTCTimestamp>[] = bars.map(b => ({
        time: b.time as UTCTimestamp,
        value: b.volume,
        color: b.close >= b.open ? '#16c78433' : '#ea394333',
      }))

      candleRef.current?.setData(candles)
      volumeRef.current?.setData(volumes)
      chartRef.current?.timeScale().fitContent()
    } finally {
      setLoading(false)
      loadRef.current = false
    }
  }, [selectedPair, timeframe])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [loadData])

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

            {/* Chart type indicator */}
            <button className="flex items-center gap-1 px-2 py-0.5 text-xs text-text-muted hover:text-text-primary bg-ax-card border border-ax-border rounded transition-colors">
              <Grid3X3 size={10} />
            </button>

            <div className="ml-auto flex items-center gap-1.5 text-2xs text-text-muted">
              {loading && <RefreshCw size={10} className="animate-spin" />}
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

          {/* Canvas */}
          <div className="relative flex-1 min-h-0">
            <div ref={containerRef} className="absolute inset-0" />
            {!selectedPair && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted pointer-events-none gap-3">
                <div className="text-5xl opacity-10">📈</div>
                <div className="text-sm text-text-muted">Select a token to view chart</div>
                <div className="text-2xs text-text-dim">Search above or click a token in the scanner</div>
              </div>
            )}
            {noData && selectedPair && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted pointer-events-none">
                <div className="text-sm">No chart data available</div>
                <div className="text-xs mt-1 text-text-dim">Try a different timeframe</div>
              </div>
            )}
          </div>

          {/* Bottom tabs: Positions / Orders / Holders / Top Traders / Dev Tokens */}
          <div className="border-t border-ax-border" style={{ height: 200 }}>
            <ChartBottomTabs pair={selectedPair} />
          </div>
        </div>
      </div>
    </div>
  )
}
