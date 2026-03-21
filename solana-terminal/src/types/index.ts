export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  tags?: string[]
  extensions?: {
    coingeckoId?: string
    website?: string
    twitter?: string
    telegram?: string
  }
}

export interface TokenPair {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: {
    address: string
    name: string
    symbol: string
  }
  quoteToken: {
    address: string
    name: string
    symbol: string
  }
  priceNative: string
  priceUsd?: string
  txns: {
    m5: { buys: number; sells: number }
    h1: { buys: number; sells: number }
    h6: { buys: number; sells: number }
    h24: { buys: number; sells: number }
  }
  volume: {
    h24: number
    h6: number
    h1: number
    m5: number
  }
  priceChange: {
    m5: number
    h1: number
    h6: number
    h24: number
  }
  liquidity?: {
    usd?: number
    base: number
    quote: number
  }
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
  info?: {
    imageUrl?: string
    header?: string
    openGraph?: string
    websites?: Array<{ label: string; url: string }>
    socials?: Array<{ type: string; url: string }>
  }
  boosts?: { active: number }
}

export interface OHLCVBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Trade {
  signature: string
  timestamp: number
  type: 'buy' | 'sell'
  tokenIn: string
  tokenOut: string
  amountIn: number
  amountOut: number
  priceUsd: number
  valueUsd: number
}

export interface WalletToken {
  mint: string
  symbol: string
  name: string
  logoURI?: string
  balance: number
  decimals: number
  priceUsd: number
  valueUsd: number
  change24h: number
}

export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export type SortField = 'price' | 'change5m' | 'change1h' | 'change24h' | 'volume' | 'marketCap' | 'liquidity' | 'age'

export interface TrendingFilter {
  minLiquidity: number
  minVolume24h: number
  minAge: number // minutes
  maxAge: number // minutes
  hideHoneypots: boolean
  minHolders: number
}
