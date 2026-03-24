// ═══════════════════════════════════════════════════════════════
// Central API configuration — reads from env, provides fallbacks
// ═══════════════════════════════════════════════════════════════

const env = (key: string, fallback = '') =>
  (import.meta as unknown as { env: Record<string, string | undefined> }).env[key] ?? fallback

// ── Solana RPC ──────────────────────────────────────────────────
export const HELIUS_API_KEY   = env('VITE_HELIUS_API_KEY')
export const SOLANA_RPC_URL   = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : env('VITE_SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
export const SOLANA_RPC_FALLBACK = env('VITE_SOLANA_RPC_FALLBACK', 'https://rpc.ankr.com/solana')

// ── Helius Enhanced API ─────────────────────────────────────────
export const HELIUS_API_BASE = HELIUS_API_KEY
  ? `https://api.helius.xyz/v0`
  : ''
export const HELIUS_RPC_BASE = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : ''

// ── Birdeye ─────────────────────────────────────────────────────
export const BIRDEYE_API_KEY  = env('VITE_BIRDEYE_API_KEY')
export const BIRDEYE_BASE     = 'https://public-api.birdeye.so'
export const BIRDEYE_HEADERS  = BIRDEYE_API_KEY
  ? { 'X-API-KEY': BIRDEYE_API_KEY, 'x-chain': 'solana' }
  : { 'x-chain': 'solana' }

// ── GoPlus ──────────────────────────────────────────────────────
export const GOPLUS_API_KEY   = env('VITE_GOPLUS_API_KEY')
export const GOPLUS_BASE      = 'https://api.gopluslabs.io/api/v1'

// ── Jupiter ─────────────────────────────────────────────────────
export const JUPITER_QUOTE    = env('VITE_JUPITER_ENDPOINT', 'https://quote-api.jup.ag/v6')
export const JUPITER_PRICE    = 'https://price.jup.ag/v6'
export const JUPITER_TOKENS   = 'https://tokens.jup.ag/tokens?tags=verified'

// ── DexScreener ─────────────────────────────────────────────────
export const DEXSCREENER_BASE = 'https://api.dexscreener.com'

// ── GeckoTerminal ───────────────────────────────────────────────
export const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2'

// ── CoinGecko ───────────────────────────────────────────────────
export const COINGECKO_API_KEY = env('VITE_COINGECKO_API_KEY')
export const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3'
export const COINGECKO_HEADERS = COINGECKO_API_KEY
  ? { 'x-cg-pro-api-key': COINGECKO_API_KEY }
  : {}

// ── Binance ─────────────────────────────────────────────────────
export const BINANCE_WS    = 'wss://stream.binance.com:9443'
export const BINANCE_REST  = 'https://api.binance.com/api/v3'

// ── Feature flags (which premium APIs are available) ────────────
export const HAS_HELIUS  = !!HELIUS_API_KEY
export const HAS_BIRDEYE = !!BIRDEYE_API_KEY
export const HAS_GOPLUS  = true  // GoPlus free tier works without key
export const HAS_COINGECKO_PRO = !!COINGECKO_API_KEY

// ── Rate limit helpers ──────────────────────────────────────────
const rateLimits = new Map<string, number[]>()

export function checkRateLimit(service: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const hits = rateLimits.get(service) ?? []
  const recent = hits.filter(t => now - t < 60000)
  if (recent.length >= maxPerMinute) return false
  recent.push(now)
  rateLimits.set(service, recent)
  return true
}

// ── Retry with backoff ──────────────────────────────────────────
export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retries = 3,
  backoffMs = 1000,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts)
      if (r.ok || r.status === 429) return r
      if (i === retries) return r
    } catch (err) {
      if (i === retries) throw err
    }
    await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, i)))
  }
  throw new Error(`fetchWithRetry: all ${retries} retries failed for ${url}`)
}
