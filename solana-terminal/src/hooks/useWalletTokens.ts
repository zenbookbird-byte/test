import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getTokenPrices } from '../services/jupiter'
import type { WalletToken } from '../types'

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

interface RawTokenAccount {
  pubkey: string
  account: {
    data: {
      parsed: {
        info: {
          mint: string
          tokenAmount: {
            uiAmount: number
            decimals: number
          }
        }
      }
    }
  }
}

export function useWalletTokens() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()

  return useQuery<WalletToken[]>({
    queryKey: ['walletTokens', publicKey?.toBase58()],
    enabled: !!publicKey,
    queryFn: async () => {
      if (!publicKey) return []

      // Get SOL balance
      const solBalance = await connection.getBalance(publicKey)
      const solUi = solBalance / 1e9

      // Get token accounts
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey(TOKEN_PROGRAM),
      })

      const mints = tokenAccounts.value
        .map(a => a.account.data.parsed.info.mint)
        .filter(Boolean)

      // Get prices from Jupiter
      const SOL_MINT = 'So11111111111111111111111111111111111111112'
      const prices = await getTokenPrices([SOL_MINT, ...mints.slice(0, 20)])

      const solPrice = prices[SOL_MINT] ?? 0

      const tokens: WalletToken[] = [
        {
          mint: SOL_MINT,
          symbol: 'SOL',
          name: 'Solana',
          logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
          balance: solUi,
          decimals: 9,
          priceUsd: solPrice,
          valueUsd: solUi * solPrice,
          change24h: 0,
        },
      ]

      for (const { account } of tokenAccounts.value as unknown as RawTokenAccount[]) {
        const info = account.data.parsed.info
        const balance = info.tokenAmount.uiAmount
        if (!balance || balance === 0) continue
        const price = prices[info.mint] ?? 0
        tokens.push({
          mint: info.mint,
          symbol: info.mint.slice(0, 6) + '...',
          name: 'Unknown',
          balance,
          decimals: info.tokenAmount.decimals,
          priceUsd: price,
          valueUsd: balance * price,
          change24h: 0,
        })
      }

      return tokens.sort((a, b) => b.valueUsd - a.valueUsd)
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useSOLBalance() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  return useQuery<number>({
    queryKey: ['solBalance', publicKey?.toBase58()],
    enabled: !!publicKey,
    queryFn: async () => {
      if (!publicKey) return 0
      const bal = await connection.getBalance(publicKey)
      return bal / 1e9
    },
    refetchInterval: 10_000,
  })
}
