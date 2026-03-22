export type TraderTag = 'smart' | 'whale' | 'degen' | 'kol' | 'bot'

export interface DailyPnl {
  date: string   // 'YYYY-MM-DD'
  pnlUsd: number
  trades: number
}

export interface TraderHolding {
  symbol: string
  name: string
  unrealizedPct: number
  unrealizedUsd: number
  realizedUsd: number
  balance: number
  balanceUsd: number
  position: number   // % of portfolio
  holdingDuration: string
  boughtMc: string
  soldMc: string
  txns: number
}

export interface Trader {
  id: string
  address: string
  name?: string
  avatarSeed: number    // 0-9 for color
  tags: TraderTag[]
  daysTracked: number
  verified: boolean

  // 7D stats
  winRate7d: number
  pnlPct7d: number
  pnlUsd7d: number
  totalTrades7d: number
  uniqueTokens7d: number
  renamedTokens7d: number
  avgDuration7d: string
  cost7d: number
  avgCostPerBuy7d: number
  avgSoldPrice7d: number
  avgRealizedProfit7d: number
  fees7d: number
  volume7d: number
  solBalance: number
  usdBalance: number

  // Phishing check
  blacklistCount: number
  didntBuyCount: number
  soldGtBought: number
  buySellIn5s: number

  // Distribution %
  distGt500: number
  dist200to500: number
  dist0to200: number
  distNeg50to0: number
  distLtNeg50: number

  // Avg Buy MC
  mc0to100k: number
  mc100kto500k: number
  mcGt500k: number

  // Social
  followers: number
  copyTraders: number

  // Calendar
  dailyPnl: DailyPnl[]

  // Holdings
  holdings: TraderHolding[]
}

function addr(seed: string) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789'
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i)
  let r = ''
  for (let i = 0; i < 44; i++) { h = ((h << 5) + h) ^ (h >> 16); r += chars[Math.abs(h) % chars.length] }
  return r
}

function makeDailyPnl(winRate: number, pnlUsd7d: number): DailyPnl[] {
  const out: DailyPnl[] = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const isWin = Math.random() < winRate / 100
    const base = pnlUsd7d / 7
    const pnlUsd = isWin
      ? base * (0.2 + Math.random() * 2.5)
      : -Math.abs(base) * (0.1 + Math.random() * 0.8)
    const trades = Math.floor(Math.random() * 12) + 1
    out.push({ date, pnlUsd: Math.round(pnlUsd), trades })
  }
  return out
}

function makeHoldings(): TraderHolding[] {
  const tokens = [
    { symbol: 'BONK', name: 'Bonk' },
    { symbol: 'WIF', name: 'dogwifhat' },
    { symbol: 'POPCAT', name: 'Popcat' },
    { symbol: 'GOAT', name: 'Goatseus Maximus' },
    { symbol: 'MEW', name: 'cat in a dogs world' },
  ]
  return tokens.slice(0, 2 + Math.floor(Math.random() * 3)).map(t => ({
    ...t,
    unrealizedPct: (Math.random() - 0.3) * 300,
    unrealizedUsd: Math.random() * 5000 - 500,
    realizedUsd: Math.random() * 8000,
    balance: Math.random() * 1000000,
    balanceUsd: Math.random() * 3000,
    position: Math.random() * 40 + 5,
    holdingDuration: ['2h', '5h', '1d', '3d', '12h'][Math.floor(Math.random() * 5)],
    boughtMc: ['$45K', '$120K', '$890K', '$2.1M', '$340K'][Math.floor(Math.random() * 5)],
    soldMc: ['$450K', '$1.2M', '$8.9M', '$21M', '$3.4M'][Math.floor(Math.random() * 5)],
    txns: Math.floor(Math.random() * 20) + 1,
  }))
}

const RAW: Omit<Trader, 'address' | 'dailyPnl' | 'holdings'>[] = [
  {
    id: 't1', name: 'SolSniper_X', avatarSeed: 0, tags: ['smart', 'whale'],
    daysTracked: 190, verified: true,
    winRate7d: 95.6, pnlPct7d: 101.43, pnlUsd7d: 38100,
    totalTrades7d: 94, uniqueTokens7d: 93, renamedTokens7d: 425,
    avgDuration7d: '2h', cost7d: 36600, avgCostPerBuy7d: 389.73, avgSoldPrice7d: 434.42,
    avgRealizedProfit7d: 218.75, fees7d: 865888, volume7d: 112200,
    solBalance: 44.62, usdBalance: 3900,
    blacklistCount: 0, didntBuyCount: 0, soldGtBought: 0, buySellIn5s: 42,
    distGt500: 0, dist200to500: 4.1, dist0to200: 91.4, distNeg50to0: 4.1, distLtNeg50: 0,
    mc0to100k: 93, mc100kto500k: 0, mcGt500k: 0,
    followers: 2840, copyTraders: 341,
  },
  {
    id: 't2', name: 'AlphaWalletPro', avatarSeed: 2, tags: ['smart'],
    daysTracked: 145, verified: true,
    winRate7d: 88.2, pnlPct7d: 74.5, pnlUsd7d: 21400,
    totalTrades7d: 67, uniqueTokens7d: 62, renamedTokens7d: 280,
    avgDuration7d: '4h', cost7d: 28700, avgCostPerBuy7d: 428.0, avgSoldPrice7d: 498.5,
    avgRealizedProfit7d: 195.0, fees7d: 620000, volume7d: 89400,
    solBalance: 31.4, usdBalance: 5600,
    blacklistCount: 0, didntBuyCount: 0, soldGtBought: 1, buySellIn5s: 18,
    distGt500: 2.1, dist200to500: 8.9, dist0to200: 79.5, distNeg50to0: 8.5, distLtNeg50: 1.0,
    mc0to100k: 78, mc100kto500k: 12, mcGt500k: 2,
    followers: 1920, copyTraders: 218,
  },
  {
    id: 't3', name: 'DegenMaster99', avatarSeed: 4, tags: ['degen', 'kol'],
    daysTracked: 210, verified: false,
    winRate7d: 82.4, pnlPct7d: 189.7, pnlUsd7d: 54200,
    totalTrades7d: 142, uniqueTokens7d: 138, renamedTokens7d: 510,
    avgDuration7d: '45m', cost7d: 28600, avgCostPerBuy7d: 201.0, avgSoldPrice7d: 583.2,
    avgRealizedProfit7d: 382.0, fees7d: 1240000, volume7d: 238000,
    solBalance: 89.1, usdBalance: 15600,
    blacklistCount: 1, didntBuyCount: 2, soldGtBought: 3, buySellIn5s: 87,
    distGt500: 12.5, dist200to500: 22.3, dist0to200: 52.1, distNeg50to0: 10.2, distLtNeg50: 2.9,
    mc0to100k: 112, mc100kto500k: 18, mcGt500k: 5,
    followers: 5600, copyTraders: 892,
  },
  {
    id: 't4', name: undefined, avatarSeed: 6, tags: ['smart', 'bot'],
    daysTracked: 78, verified: false,
    winRate7d: 91.0, pnlPct7d: 55.3, pnlUsd7d: 14800,
    totalTrades7d: 211, uniqueTokens7d: 205, renamedTokens7d: 390,
    avgDuration7d: '18m', cost7d: 26800, avgCostPerBuy7d: 127.0, avgSoldPrice7d: 198.0,
    avgRealizedProfit7d: 70.0, fees7d: 1820000, volume7d: 41700,
    solBalance: 18.9, usdBalance: 3300,
    blacklistCount: 0, didntBuyCount: 0, soldGtBought: 0, buySellIn5s: 156,
    distGt500: 0.5, dist200to500: 3.2, dist0to200: 87.3, distNeg50to0: 8.5, distLtNeg50: 0.5,
    mc0to100k: 185, mc100kto500k: 14, mcGt500k: 1,
    followers: 890, copyTraders: 124,
  },
  {
    id: 't5', name: 'CryptoNinja_Sol', avatarSeed: 1, tags: ['kol'],
    daysTracked: 330, verified: true,
    winRate7d: 78.9, pnlPct7d: 44.1, pnlUsd7d: 31900,
    totalTrades7d: 38, uniqueTokens7d: 35, renamedTokens7d: 180,
    avgDuration7d: '8h', cost7d: 72300, avgCostPerBuy7d: 1902.0, avgSoldPrice7d: 2740.0,
    avgRealizedProfit7d: 838.0, fees7d: 328000, volume7d: 104000,
    solBalance: 212.5, usdBalance: 37100,
    blacklistCount: 0, didntBuyCount: 1, soldGtBought: 2, buySellIn5s: 8,
    distGt500: 5.3, dist200to500: 13.2, dist0to200: 60.5, distNeg50to0: 18.4, distLtNeg50: 2.6,
    mc0to100k: 28, mc100kto500k: 6, mcGt500k: 2,
    followers: 12400, copyTraders: 1840,
  },
  {
    id: 't6', name: 'QuickFlipKing', avatarSeed: 8, tags: ['degen'],
    daysTracked: 62, verified: false,
    winRate7d: 71.2, pnlPct7d: 312.4, pnlUsd7d: 89600,
    totalTrades7d: 318, uniqueTokens7d: 290, renamedTokens7d: 720,
    avgDuration7d: '12m', cost7d: 28700, avgCostPerBuy7d: 90.3, avgSoldPrice7d: 372.0,
    avgRealizedProfit7d: 281.7, fees7d: 2740000, volume7d: 118000,
    solBalance: 48.3, usdBalance: 8400,
    blacklistCount: 3, didntBuyCount: 5, soldGtBought: 7, buySellIn5s: 234,
    distGt500: 28.4, dist200to500: 18.9, dist0to200: 38.2, distNeg50to0: 10.4, distLtNeg50: 4.1,
    mc0to100k: 248, mc100kto500k: 28, mcGt500k: 4,
    followers: 3210, copyTraders: 567,
  },
  {
    id: 't7', name: 'WhaleAlert_7', avatarSeed: 3, tags: ['whale'],
    daysTracked: 420, verified: true,
    winRate7d: 84.6, pnlPct7d: 28.9, pnlUsd7d: 128000,
    totalTrades7d: 26, uniqueTokens7d: 24, renamedTokens7d: 120,
    avgDuration7d: '2d', cost7d: 442000, avgCostPerBuy7d: 17000.0, avgSoldPrice7d: 22500.0,
    avgRealizedProfit7d: 5500.0, fees7d: 224000, volume7d: 585000,
    solBalance: 2480.0, usdBalance: 433000,
    blacklistCount: 0, didntBuyCount: 0, soldGtBought: 0, buySellIn5s: 2,
    distGt500: 3.8, dist200to500: 15.4, dist0to200: 65.4, distNeg50to0: 13.5, distLtNeg50: 1.9,
    mc0to100k: 8, mc100kto500k: 12, mcGt500k: 8,
    followers: 18900, copyTraders: 2340,
  },
  {
    id: 't8', name: 'MEV_Hunter_Pro', avatarSeed: 5, tags: ['bot', 'smart'],
    daysTracked: 55, verified: false,
    winRate7d: 93.8, pnlPct7d: 67.2, pnlUsd7d: 18900,
    totalTrades7d: 489, uniqueTokens7d: 340, renamedTokens7d: 840,
    avgDuration7d: '3m', cost7d: 28100, avgCostPerBuy7d: 57.5, avgSoldPrice7d: 96.2,
    avgRealizedProfit7d: 38.7, fees7d: 4210000, volume7d: 47100,
    solBalance: 24.8, usdBalance: 4300,
    blacklistCount: 0, didntBuyCount: 0, soldGtBought: 0, buySellIn5s: 412,
    distGt500: 0.2, dist200to500: 1.2, dist0to200: 92.6, distNeg50to0: 5.8, distLtNeg50: 0.2,
    mc0to100k: 420, mc100kto500k: 42, mcGt500k: 0,
    followers: 430, copyTraders: 89,
  },
]

export const TRADERS: Trader[] = RAW.map(t => ({
  ...t,
  address: addr(t.id + t.avatarSeed),
  dailyPnl: makeDailyPnl(t.winRate7d, t.pnlUsd7d),
  holdings: makeHoldings(),
}))

export const AVATAR_COLORS = [
  'from-purple-DEFAULT to-blue-accent',
  'from-green-DEFAULT to-blue-accent',
  'from-yellow-DEFAULT to-red-DEFAULT',
  'from-pink-500 to-purple-DEFAULT',
  'from-orange-400 to-yellow-DEFAULT',
  'from-blue-accent to-purple-DEFAULT',
  'from-green-DEFAULT to-yellow-DEFAULT',
  'from-red-DEFAULT to-orange-400',
  'from-purple-DEFAULT to-pink-500',
  'from-blue-accent to-green-DEFAULT',
]

export function shortAddr(addr: string) {
  return addr.slice(0, 4) + '...' + addr.slice(-4)
}

export function fmtUsd(n: number, decimals = 0) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}K`
  return `${n < 0 ? '-$' : '$'}${abs.toFixed(decimals)}`
}
