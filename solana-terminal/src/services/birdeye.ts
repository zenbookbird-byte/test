// ═══════════════════════════════════════════════════════════════
// Birdeye API — Professional token analytics for Solana
// https://docs.birdeye.so
// ═══════════════════════════════════════════════════════════════

import { BIRDEYE_BASE, BIRDEYE_HEADERS, HAS_BIRDEYE, fetchWithRetry, checkRateLimit } from './apiConfig'

// ── Types ────────────────────────────────────────────────────────
export interface BirdeyeTokenOverview {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI: string
  price: number
  priceChange24hPercent: number
  priceChange1hPercent: number
  priceChange4hPercent: number
  priceChange12hPercent: number
  volume24hUSD: number
  volume24hChangePercent: number
  liquidity: number
  mc: number               // market cap
  realMc: number            // real market cap (excl locked)
  supply: number
  circulatingSupply: number
  holder: number            // holder count
  trade24h: number          // 24h trade count
  trade24hChangePercent: number
  buy24h: number
  sell24h: number
  uniqueWallet24h: number
  uniqueWallet24hChangePercent: number
  lastTradeUnixTime: number
  lastTradeHumanTime: string
  numberMarkets: number
  extensions?: {
    twitter?: string
    website?: string
    telegram?: string
    discord?: string
    description?: string
  }
}

export interface BirdeyeOHLCV {
  o: number; h: number; l: number; c: number; v: number
  unixTime: number
  address: string
  type: string
}

export interface BirdeyeTradeData {
  items: {
    side: 'buy' | 'sell'
    source: string
    blockUnixTime: number
    txHash: string
    owner: string
    from: { symbol: string; decimals: number; amount: number; uiAmount: number; nearestPrice: number }
    to:   { symbol: string; decimals: number; amount: number; uiAmount: number; nearestPrice: number }
    volumeUSD: number
  }[]
  hasNext: boolean
}

export interface BirdeyeTopTrader {
  wallet: string
  totalPnl: number
  totalBuy: number
  totalSell: number
  txCount: number
  tradePnl: number
  tradeVolume: number
  lastTradeTime: number
}

export interface BirdeyeTokenSecurity {
  creatorAddress: string
  creationTx: string
  creationTime: number
  mintAuthority: string | null
  freezeAuthority: string | null
  isToken2022: boolean
  ownerAddress: string | null
  ownerBalance: number
  ownerPercentage: number
  top10HolderBalance: number
  top10HolderPercent: number
  isMutable: boolean
  totalSupply: number
  preMarketHolder: number[]
  lockInfo: {
    locked: boolean
    lockPercent: number
    unlockTime: number | null
  } | null
}

// ── Helpers ─────────────────────────────────────────────────────
async function birdeyeFetch<T>(path: string): Promise<T | null> {
  const rateOk = checkRateLimit('birdeye', HAS_BIRDEYE ? 600 : 5)
  if (!rateOk) return null
  try {
    const r = await fetchWithRetry(`${BIRDEYE_BASE}${path}`, { headers: BIRDEYE_HEADERS as Record<string, string> })
    if (!r.ok) return null
    const json = await r.json() as { success: boolean; data: T }
    return json.success ? json.data : null
  } catch { return null }
}

// ── Token overview (comprehensive) ──────────────────────────────
export async function getTokenOverview(address: string): Promise<BirdeyeTokenOverview | null> {
  return birdeyeFetch<BirdeyeTokenOverview>(`/defi/token_overview?address=${address}`)
}

// ── OHLCV candles ───────────────────────────────────────────────
export async function getOHLCV(
  address: string,
  timeframe: '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' = '15m',
  timeFrom?: number,
  timeTo?: number,
): Promise<BirdeyeOHLCV[]> {
  const now = Math.floor(Date.now() / 1000)
  const from = timeFrom ?? now - 86400
  const to = timeTo ?? now
  const data = await birdeyeFetch<{ items: BirdeyeOHLCV[] }>(
    `/defi/ohlcv?address=${address}&type=${timeframe}&time_from=${from}&time_to=${to}`
  )
  return data?.items ?? []
}

// ── Live trades ─────────────────────────────────────────────────
export async function getRecentTrades(address: string, limit = 50): Promise<BirdeyeTradeData | null> {
  return birdeyeFetch<BirdeyeTradeData>(
    `/defi/txs/token?address=${address}&tx_type=swap&sort_type=desc&limit=${limit}`
  )
}

// ── Top traders for a token ─────────────────────────────────────
export async function getTopTraders(address: string, timeframe: '24h' | '7d' | '30d' = '24h'): Promise<BirdeyeTopTrader[]> {
  const data = await birdeyeFetch<{ items: BirdeyeTopTrader[] }>(
    `/defi/v2/tokens/${address}/top_traders?time_frame=${timeframe}`
  )
  return data?.items ?? []
}

// ── Token security ──────────────────────────────────────────────
export async function getTokenSecurity(address: string): Promise<BirdeyeTokenSecurity | null> {
  return birdeyeFetch<BirdeyeTokenSecurity>(`/defi/token_security?address=${address}`)
}

// ── Price history (for sparklines) ──────────────────────────────
export async function getPriceHistory(
  address: string,
  intervalType: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' = '15m',
  timeFrom?: number,
  timeTo?: number,
): Promise<{ value: number; unixTime: number }[]> {
  const now = Math.floor(Date.now() / 1000)
  const from = timeFrom ?? now - 86400
  const to = timeTo ?? now
  const data = await birdeyeFetch<{ items: { value: number; unixTime: number }[] }>(
    `/defi/history_price?address=${address}&address_type=token&type=${intervalType}&time_from=${from}&time_to=${to}`
  )
  return data?.items ?? []
}

// ── Trending tokens ─────────────────────────────────────────────
export async function getTrendingTokens(
  sortBy: 'rank' | 'volume24hUSD' | 'priceChange24hPercent' = 'rank',
  sortType: 'asc' | 'desc' = 'desc',
  offset = 0,
  limit = 20,
): Promise<BirdeyeTokenOverview[]> {
  const data = await birdeyeFetch<{ tokens: BirdeyeTokenOverview[] }>(
    `/defi/token_trending?sort_by=${sortBy}&sort_type=${sortType}&offset=${offset}&limit=${limit}`
  )
  return data?.tokens ?? []
}

// ── Multi-price (batch) ─────────────────────────────────────────
export async function getMultiPrice(addresses: string[]): Promise<Record<string, { value: number; updateUnixTime: number }>> {
  if (addresses.length === 0) return {}
  const data = await birdeyeFetch<Record<string, { value: number; updateUnixTime: number }>>(
    `/defi/multi_price?list_address=${addresses.join(',')}`
  )
  return data ?? {}
}

// ── New listings ────────────────────────────────────────────────
export async function getNewListings(limit = 20): Promise<BirdeyeTokenOverview[]> {
  const data = await birdeyeFetch<{ tokens: BirdeyeTokenOverview[] }>(
    `/defi/v2/tokens/new_listing?limit=${limit}`
  )
  return data?.tokens ?? []
}

// ── Wallet portfolio ────────────────────────────────────────────
export async function getWalletPortfolio(wallet: string): Promise<{
  totalUsd: number
  items: { address: string; symbol: string; name: string; decimals: number
    balance: number; uiAmount: number; valueUsd: number; priceUsd: number
    priceChangePercent24h: number; logoURI: string }[]
} | null> {
  return birdeyeFetch(`/v1/wallet/token_list?wallet=${wallet}`)
}
