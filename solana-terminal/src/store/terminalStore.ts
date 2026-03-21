import { create } from 'zustand'
import type { TokenPair, TimeFrame } from '../types'

export type PageView = 'discover' | 'pulse' | 'trackers' | 'perpetuals' | 'yield' | 'portfolio'
export type MainTab = 'trending' | 'new' | 'watchlist' | 'portfolio' | 'wallettracker'
export type OrderType = 'market' | 'limit' | 'dca'
export type RightTab = 'trade' | 'info' | 'holders' | 'trades'

interface TerminalState {
  // Navigation
  pageView: PageView
  setPageView: (v: PageView) => void

  selectedPair: TokenPair | null
  setSelectedPair: (p: TokenPair | null) => void

  mainTab: MainTab
  setMainTab: (t: MainTab) => void

  rightTab: RightTab
  setRightTab: (t: RightTab) => void

  timeframe: TimeFrame
  setTimeframe: (tf: TimeFrame) => void

  searchQuery: string
  setSearchQuery: (q: string) => void

  // Order state
  orderType: OrderType
  setOrderType: (t: OrderType) => void
  swapSide: 'buy' | 'sell'
  setSwapSide: (s: 'buy' | 'sell') => void
  swapInputAmount: string
  setSwapInputAmount: (v: string) => void
  slippage: number
  setSlippage: (s: number) => void
  priorityFee: 'low' | 'medium' | 'high' | 'ultra'
  setPriorityFee: (f: TerminalState['priorityFee']) => void
  limitPrice: string
  setLimitPrice: (v: string) => void
  stopLoss: string
  setStopLoss: (v: string) => void
  takeProfit: string
  setTakeProfit: (v: string) => void

  // Modes
  infernoMode: boolean
  toggleInferno: () => void
  mevProtection: boolean
  toggleMev: () => void

  // Watchlist
  watchlist: string[]
  toggleWatchlist: (addr: string) => void

  // Filters
  minLiquidity: number
  setMinLiquidity: (v: number) => void
  minVolume: number
  setMinVolume: (v: number) => void

  // Bottom bar
  quickBuyPreset: number
  setQuickBuyPreset: (v: number) => void
  activePreset: number
  setActivePreset: (v: number) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  pageView: 'discover',
  setPageView: (v) => set({ pageView: v }),

  selectedPair: null,
  setSelectedPair: (p) => {
    set({ selectedPair: p })
    // Auto-switch to discover when a pair is selected
    if (p && get().pageView !== 'discover') set({ pageView: 'discover' })
  },

  mainTab: 'trending',
  setMainTab: (t) => set({ mainTab: t }),

  rightTab: 'trade',
  setRightTab: (t) => set({ rightTab: t }),

  timeframe: '5m',
  setTimeframe: (tf) => set({ timeframe: tf }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  orderType: 'market',
  setOrderType: (t) => set({ orderType: t }),
  swapSide: 'buy',
  setSwapSide: (s) => set({ swapSide: s }),
  swapInputAmount: '',
  setSwapInputAmount: (v) => set({ swapInputAmount: v }),
  slippage: 1,
  setSlippage: (s) => set({ slippage: s }),
  priorityFee: 'medium',
  setPriorityFee: (f) => set({ priorityFee: f }),
  limitPrice: '',
  setLimitPrice: (v) => set({ limitPrice: v }),
  stopLoss: '',
  setStopLoss: (v) => set({ stopLoss: v }),
  takeProfit: '',
  setTakeProfit: (v) => set({ takeProfit: v }),

  infernoMode: false,
  toggleInferno: () => set(s => ({ infernoMode: !s.infernoMode })),
  mevProtection: true,
  toggleMev: () => set(s => ({ mevProtection: !s.mevProtection })),

  watchlist: (() => { try { return JSON.parse(localStorage.getItem('st_watchlist') || '[]') } catch { return [] } })(),
  toggleWatchlist: (addr) => {
    const wl = get().watchlist
    const next = wl.includes(addr) ? wl.filter(a => a !== addr) : [...wl, addr]
    localStorage.setItem('st_watchlist', JSON.stringify(next))
    set({ watchlist: next })
  },

  minLiquidity: 0,
  setMinLiquidity: (v) => set({ minLiquidity: v }),
  minVolume: 0,
  setMinVolume: (v) => set({ minVolume: v }),

  quickBuyPreset: 0.1,
  setQuickBuyPreset: (v) => set({ quickBuyPreset: v }),
  activePreset: 1,
  setActivePreset: (v) => set({ activePreset: v }),
}))
