import { create } from 'zustand'
import type { TokenPair, TimeFrame } from '../types'

interface TerminalState {
  // Active token/pair
  selectedPair: TokenPair | null
  setSelectedPair: (pair: TokenPair | null) => void

  // View
  activeTab: 'trending' | 'new' | 'portfolio' | 'watchlist'
  setActiveTab: (tab: TerminalState['activeTab']) => void

  // Chart
  timeframe: TimeFrame
  setTimeframe: (tf: TimeFrame) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void

  // Swap state
  swapInputAmount: string
  setSwapInputAmount: (v: string) => void
  swapSide: 'buy' | 'sell'
  setSwapSide: (s: 'buy' | 'sell') => void
  slippage: number
  setSlippage: (s: number) => void
  priorityFee: 'low' | 'medium' | 'high' | 'ultra'
  setPriorityFee: (f: TerminalState['priorityFee']) => void

  // Watchlist
  watchlist: string[] // pair addresses
  toggleWatchlist: (pairAddress: string) => void

  // Filters
  minLiquidity: number
  setMinLiquidity: (v: number) => void
  minVolume: number
  setMinVolume: (v: number) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  selectedPair: null,
  setSelectedPair: (pair) => set({ selectedPair: pair }),

  activeTab: 'trending',
  setActiveTab: (tab) => set({ activeTab: tab }),

  timeframe: '5m',
  setTimeframe: (tf) => set({ timeframe: tf }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  swapInputAmount: '',
  setSwapInputAmount: (v) => set({ swapInputAmount: v }),
  swapSide: 'buy',
  setSwapSide: (s) => set({ swapSide: s }),
  slippage: 0.5,
  setSlippage: (s) => set({ slippage: s }),
  priorityFee: 'medium',
  setPriorityFee: (f) => set({ priorityFee: f }),

  watchlist: JSON.parse(localStorage.getItem('st_watchlist') || '[]'),
  toggleWatchlist: (addr) => {
    const wl = get().watchlist
    const next = wl.includes(addr) ? wl.filter(a => a !== addr) : [...wl, addr]
    localStorage.setItem('st_watchlist', JSON.stringify(next))
    set({ watchlist: next })
  },

  minLiquidity: 5000,
  setMinLiquidity: (v) => set({ minLiquidity: v }),
  minVolume: 10000,
  setMinVolume: (v) => set({ minVolume: v }),
}))
