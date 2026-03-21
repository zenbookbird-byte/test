import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts'
import { useTerminalStore } from '../../store/terminalStore'
import { getOHLCV } from '../../services/dexscreener'
import type { OHLCVBar, TimeFrame } from '../../types'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'

const TF_MAP: Record<TimeFrame, { unit: string; agg: number }> = {
  '1m': { unit: 'minute', agg: 1 },
  '5m': { unit: 'minute', agg: 5 },
  '15m': { unit: 'minute', agg: 15 },
  '1h': { unit: 'hour', agg: 1 },
  '4h': { unit: 'hour', agg: 4 },
  '1d': { unit: 'day', agg: 1 },
}

const TIMEFRAMES: TimeFrame[] = ['1m', '5m', '15m', '1h', '4h', '1d']

export function TradingChart() {
  const { selectedPair, timeframe, setTimeframe } = useTerminalStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)
  const loadRef = useRef(false)

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f0f1a' },
        textColor: '#8888aa',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e1e3a' },
        horzLines: { color: '#1e1e3a' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#4c9eff44', labelBackgroundColor: '#141420' },
        horzLine: { color: '#4c9eff44', labelBackgroundColor: '#141420' },
      },
      rightPriceScale: {
        borderColor: '#1e1e3a',
        textColor: '#8888aa',
      },
      timeScale: {
        borderColor: '#1e1e3a',
        timeVisible: true,
        secondsVisible: false,
      },
      watermark: { visible: false },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00d4aa',
      downColor: '#ff4757',
      borderUpColor: '#00d4aa',
      borderDownColor: '#ff4757',
      wickUpColor: '#00d4aa',
      wickDownColor: '#ff4757',
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    volumeRef.current = volumeSeries

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
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

      const candles: CandlestickData[] = bars.map(b => ({
        time: b.time as number,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))

      const volumes: HistogramData[] = bars.map(b => ({
        time: b.time as number,
        value: b.volume,
        color: b.close >= b.open ? '#00d4aa33' : '#ff475733',
      }))

      candleRef.current?.setData(candles)
      volumeRef.current?.setData(volumes)
      chartRef.current?.timeScale().fitContent()
    } finally {
      setLoading(false)
      loadRef.current = false
    }
  }, [selectedPair, timeframe])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Auto refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [loadData])

  return (
    <div className="flex flex-col h-full">
      {/* Chart toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={clsx(
                'px-2 py-1 text-xs rounded font-mono transition-colors',
                timeframe === tf
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {loading && <RefreshCw size={12} className="text-text-muted animate-spin" />}
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {!selectedPair && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted pointer-events-none">
            <div className="text-4xl mb-3 opacity-20">📊</div>
            <div className="text-sm">Select a token to view chart</div>
          </div>
        )}
        {noData && selectedPair && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted pointer-events-none">
            <div className="text-sm">No chart data available</div>
            <div className="text-xs mt-1 text-text-muted">Try a different timeframe</div>
          </div>
        )}
      </div>
    </div>
  )
}
