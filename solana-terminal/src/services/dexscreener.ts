import axios from 'axios'
import type { TokenPair, OHLCVBar } from '../types'
import { DEXSCREENER_BASE, GECKOTERMINAL_BASE } from './apiConfig'

const BASE = DEXSCREENER_BASE

const api = axios.create({ baseURL: BASE, timeout: 10000 })

export async function getTrendingPairs(): Promise<TokenPair[]> {
  const { data } = await api.get('/token-boosts/top/v1')
  // Extract token addresses and fetch pair data
  if (!data || !Array.isArray(data)) return []
  const addresses = data
    .filter((t: { chainId: string }) => t.chainId === 'solana')
    .slice(0, 20)
    .map((t: { tokenAddress: string }) => t.tokenAddress)
  if (!addresses.length) return []
  return fetchPairsByTokens(addresses)
}

export async function getLatestPairs(): Promise<TokenPair[]> {
  const { data } = await api.get('/token-profiles/latest/v1')
  if (!data || !Array.isArray(data)) return []
  const addresses = data
    .filter((t: { chainId: string }) => t.chainId === 'solana')
    .slice(0, 20)
    .map((t: { tokenAddress: string }) => t.tokenAddress)
  if (!addresses.length) return []
  return fetchPairsByTokens(addresses)
}

export async function fetchPairsByTokens(addresses: string[]): Promise<TokenPair[]> {
  const chunks: string[][] = []
  for (let i = 0; i < addresses.length; i += 30) {
    chunks.push(addresses.slice(i, i + 30))
  }
  const results = await Promise.all(
    chunks.map(chunk =>
      api.get(`/tokens/v1/solana/${chunk.join(',')}`)
        .then(r => (Array.isArray(r.data) ? r.data : []))
        .catch(() => [])
    )
  )
  return results.flat()
}

export async function searchPairs(query: string): Promise<TokenPair[]> {
  const { data } = await api.get(`/latest/dex/search?q=${encodeURIComponent(query)}`)
  if (!data?.pairs) return []
  return data.pairs.filter((p: TokenPair) => p.chainId === 'solana').slice(0, 30)
}

export async function getPairByAddress(pairAddress: string): Promise<TokenPair | null> {
  const { data } = await api.get(`/latest/dex/pairs/solana/${pairAddress}`)
  if (!data?.pair) return null
  return data.pair
}

export async function getTokenPairs(tokenAddress: string): Promise<TokenPair[]> {
  const { data } = await api.get(`/latest/dex/tokens/${tokenAddress}`)
  if (!data?.pairs) return []
  return data.pairs.filter((p: TokenPair) => p.chainId === 'solana')
}

// GeckoTerminal OHLCV (DexScreener doesn't expose candles directly in free tier)
export async function getOHLCV(
  poolAddress: string,
  timeframe: string = 'minute',
  aggregate: number = 5,
  limit: number = 300
): Promise<OHLCVBar[]> {
  try {
    const url = `${GECKOTERMINAL_BASE}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=base`
    const { data } = await axios.get(url, { timeout: 10000 })
    const ohlcv = data?.data?.attributes?.ohlcv_list
    if (!ohlcv) return []
    return ohlcv.map((bar: number[]) => ({
      time: Math.floor(bar[0] / 1000),
      open: bar[1],
      high: bar[2],
      low: bar[3],
      close: bar[4],
      volume: bar[5],
    })).reverse()
  } catch {
    return []
  }
}

export function formatAge(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  const seconds = (Date.now() - timestamp) / 1000
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function formatNumber(n: number | undefined, decimals = 2): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(decimals)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(decimals)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(decimals)}K`
  if (n >= 1) return `$${n.toFixed(decimals)}`
  if (n > 0) return `$${n.toFixed(6)}`
  return '$0'
}

export function formatPercent(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}
