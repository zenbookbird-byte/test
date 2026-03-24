import { memo, useMemo } from 'react'
import type { TokenPair } from '../../types'

interface Props {
  pair: TokenPair
  width?: number
  height?: number
}

function generatePoints(pair: TokenPair): number[] {
  const c5m  = pair.priceChange?.m5  ?? 0
  const c1h  = pair.priceChange?.h1  ?? 0
  const c6h  = pair.priceChange?.h6  ?? 0
  const c24h = pair.priceChange?.h24 ?? 0

  const base = 100
  return [
    base,
    base + c24h * 0.15,
    base + c24h * 0.35,
    base + c6h  * 0.5,
    base + c6h  * 0.8,
    base + c1h  * 0.9,
    base + c1h  * 0.95,
    base + c5m  * 2,
    base + c5m  * 2.5,
  ]
}

export const Sparkline = memo(function Sparkline({ pair, width = 80, height = 28 }: Props) {
  const { d, fillD, color, fillId } = useMemo(() => {
    const points = generatePoints(pair)
    const min = Math.min(...points)
    const max = Math.max(...points)
    const range = Math.max(max - min, 0.001)
    const c24h = pair.priceChange?.h24 ?? 0
    const col = c24h >= 0 ? '#16c784' : '#ea3943'

    const pts = points.map((v, i) => ({
      x: (i / (points.length - 1)) * width,
      y: height - ((v - min) / range) * (height - 4) - 2,
    }))

    let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const cpx = (p0.x + p1.x) / 2
      path += ` C ${cpx.toFixed(1)} ${p0.y.toFixed(1)} ${cpx.toFixed(1)} ${p1.y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
    }

    const fill = `${path} L ${pts[pts.length - 1].x} ${height} L 0 ${height} Z`
    const id = `spark-${pair.pairAddress.slice(0, 8)}`

    return { d: path, fillD: fill, color: col, fillId: id }
  }, [pair.pairAddress, pair.priceChange?.m5, pair.priceChange?.h1, pair.priceChange?.h6, pair.priceChange?.h24, width, height])

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" className="overflow-visible">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${fillId})`} />
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
})
