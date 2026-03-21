import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getTrendingPairs, getLatestPairs, searchPairs } from '../services/dexscreener'
import type { TokenPair } from '../types'

export function useTrendingPairs() {
  return useQuery<TokenPair[]>({
    queryKey: ['trending'],
    queryFn: getTrendingPairs,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useNewPairs() {
  return useQuery<TokenPair[]>({
    queryKey: ['new'],
    queryFn: getLatestPairs,
    refetchInterval: 20_000,
    staleTime: 10_000,
  })
}

export function useSearchPairs(query: string) {
  return useQuery<TokenPair[]>({
    queryKey: ['search', query],
    queryFn: () => searchPairs(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
  })
}

export function useLivePairPrice(pair: TokenPair | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!pair) return
    const interval = setInterval(async () => {
      // Re-fetch pair data for live price
      qc.invalidateQueries({ queryKey: ['pair', pair.pairAddress] })
    }, 5000)
    return () => clearInterval(interval)
  }, [pair, qc])
}
