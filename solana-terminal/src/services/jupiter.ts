import axios from 'axios'

const JUPITER_API = 'https://quote-api.jup.ag/v6'
const TOKEN_LIST = 'https://tokens.jup.ag/tokens?tags=verified'

export interface JupiterQuote {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  platformFee: null
  priceImpactPct: string
  routePlan: RoutePlan[]
  contextSlot: number
  timeTaken: number
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string
    label: string
    inputMint: string
    outputMint: string
    inAmount: string
    outAmount: string
    feeAmount: string
    feeMint: string
  }
  percent: number
}

export interface JupiterToken {
  address: string
  chainId: number
  decimals: number
  name: string
  symbol: string
  logoURI?: string
  tags?: string[]
  extensions?: Record<string, string>
}

let tokenListCache: JupiterToken[] | null = null

export async function getTokenList(): Promise<JupiterToken[]> {
  if (tokenListCache) return tokenListCache
  const { data } = await axios.get(TOKEN_LIST, { timeout: 15000 })
  tokenListCache = Array.isArray(data) ? data : []
  return tokenListCache!
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 50
): Promise<JupiterQuote | null> {
  try {
    const { data } = await axios.get(`${JUPITER_API}/quote`, {
      params: { inputMint, outputMint, amount, slippageBps },
      timeout: 10000,
    })
    return data
  } catch (e) {
    console.error('Jupiter quote error:', e)
    return null
  }
}

export async function getSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string,
  priorityFeeLamports: number = 5000
): Promise<string | null> {
  try {
    const { data } = await axios.post(
      `${JUPITER_API}/swap`,
      {
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFeeLamports,
      },
      { timeout: 15000 }
    )
    return data.swapTransaction
  } catch (e) {
    console.error('Jupiter swap error:', e)
    return null
  }
}

// SOL and USDC mints
export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

export async function getTokenPrice(mint: string): Promise<number | null> {
  try {
    const { data } = await axios.get(`https://price.jup.ag/v6/price?ids=${mint}`, {
      timeout: 8000,
    })
    return data?.data?.[mint]?.price ?? null
  } catch {
    return null
  }
}

export async function getTokenPrices(mints: string[]): Promise<Record<string, number>> {
  try {
    const ids = mints.join(',')
    const { data } = await axios.get(`https://price.jup.ag/v6/price?ids=${ids}`, {
      timeout: 8000,
    })
    const result: Record<string, number> = {}
    if (data?.data) {
      for (const [mint, info] of Object.entries(data.data as Record<string, { price: number }>)) {
        result[mint] = info.price
      }
    }
    return result
  } catch {
    return {}
  }
}
