// ═══════════════════════════════════════════════════════════════
// GoPlus Security API — Token rug/scam detection
// https://docs.gopluslabs.io
// Free: 200 req/day (no key needed for basic)
// ═══════════════════════════════════════════════════════════════

import { GOPLUS_BASE, fetchWithRetry, checkRateLimit } from './apiConfig'

// ── Types ────────────────────────────────────────────────────────
export interface GoPlusTokenSecurity {
  // Core risk flags (1 = risky, 0 = safe, null = unknown)
  is_open_source:        string | null  // contract source verified
  is_proxy:              string | null  // upgradable proxy
  is_mintable:           string | null  // can mint new tokens
  can_take_back_ownership: string | null
  owner_change_balance:  string | null  // owner can change balance
  hidden_owner:          string | null
  selfdestruct:          string | null
  external_call:         string | null
  is_honeypot:           string | null  // cannot sell
  transfer_pausable:     string | null
  is_blacklisted:        string | null
  is_whitelisted:        string | null
  is_anti_whale:         string | null
  trading_cooldown:      string | null
  personal_slippage_modifiable: string | null

  // Trading info
  buy_tax:  string | null  // "0.05" = 5%
  sell_tax: string | null
  slippage_modifiable: string | null

  // Holder info
  holder_count:   string | null
  total_supply:   string | null
  lp_holder_count: string | null
  lp_total_supply: string | null

  // Top holders
  holders?: {
    address: string
    tag: string
    is_locked: number
    balance: string
    percent: string
    is_contract: number
  }[]

  // LP holders
  lp_holders?: {
    address: string
    tag: string
    is_locked: number
    balance: string
    percent: string
    is_contract: number
    NFT_list?: unknown[]
  }[]

  // DEX info
  dex?: {
    name: string
    liquidity: string
    pair: string
  }[]

  // Creator info
  creator_address: string | null
  creator_balance: string | null
  creator_percent: string | null

  // Owner info
  owner_address: string | null
  owner_balance: string | null
  owner_percent: string | null

  // Token name/symbol
  token_name:   string | null
  token_symbol: string | null
}

export interface GoPlusRiskSummary {
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  riskScore: number   // 0–100, lower = safer
  risks: string[]
  warnings: string[]
  info: string[]
}

// ── Fetch token security ────────────────────────────────────────
export async function getTokenSecurity(address: string): Promise<GoPlusTokenSecurity | null> {
  if (!checkRateLimit('goplus', 180)) return null
  try {
    // Solana chain_id = solana
    const r = await fetchWithRetry(`${GOPLUS_BASE}/token_security/solana?contract_addresses=${address}`)
    if (!r.ok) return null
    const json = await r.json() as { code: number; result: Record<string, GoPlusTokenSecurity> }
    if (json.code !== 1) return null
    return json.result[address.toLowerCase()] ?? json.result[address] ?? null
  } catch { return null }
}

// ── Analyze into human-readable risk summary ────────────────────
export function analyzeRisks(data: GoPlusTokenSecurity): GoPlusRiskSummary {
  const risks: string[] = []
  const warnings: string[] = []
  const info: string[] = []

  // Critical risks
  if (data.is_honeypot === '1')               risks.push('Honeypot — cannot sell tokens')
  if (data.is_mintable === '1')               risks.push('Mintable — supply can be inflated')
  if (data.owner_change_balance === '1')      risks.push('Owner can change balances')
  if (data.can_take_back_ownership === '1')   risks.push('Ownership can be reclaimed')
  if (data.selfdestruct === '1')              risks.push('Contract has self-destruct')
  if (data.hidden_owner === '1')              risks.push('Hidden owner detected')

  // Warnings
  if (data.is_proxy === '1')                  warnings.push('Upgradable proxy contract')
  if (data.transfer_pausable === '1')         warnings.push('Transfers can be paused')
  if (data.is_blacklisted === '1')            warnings.push('Has blacklist function')
  if (data.is_whitelisted === '1')            warnings.push('Has whitelist function')
  if (data.trading_cooldown === '1')          warnings.push('Trading cooldown enabled')
  if (data.external_call === '1')             warnings.push('Makes external calls')
  if (data.personal_slippage_modifiable === '1') warnings.push('Slippage can be modified per-user')

  // Tax warnings
  const buyTax  = parseFloat(data.buy_tax  ?? '0')
  const sellTax = parseFloat(data.sell_tax ?? '0')
  if (buyTax > 0.1)  warnings.push(`High buy tax: ${(buyTax * 100).toFixed(1)}%`)
  if (sellTax > 0.1) warnings.push(`High sell tax: ${(sellTax * 100).toFixed(1)}%`)
  if (buyTax > 0 && buyTax <= 0.1)  info.push(`Buy tax: ${(buyTax * 100).toFixed(1)}%`)
  if (sellTax > 0 && sellTax <= 0.1) info.push(`Sell tax: ${(sellTax * 100).toFixed(1)}%`)

  // Holder concentration
  const creatorPct = parseFloat(data.creator_percent ?? '0')
  const ownerPct   = parseFloat(data.owner_percent ?? '0')
  if (creatorPct > 0.2) warnings.push(`Creator holds ${(creatorPct * 100).toFixed(1)}%`)
  if (ownerPct > 0.2)   warnings.push(`Owner holds ${(ownerPct * 100).toFixed(1)}%`)

  // LP info
  const lpLocked = data.lp_holders?.some(h => h.is_locked === 1)
  if (lpLocked) info.push('LP partially locked')
  if (data.lp_holders && !lpLocked) warnings.push('LP not locked')

  // Info
  if (data.is_open_source === '1') info.push('Contract verified')
  if (data.holder_count)           info.push(`${parseInt(data.holder_count).toLocaleString()} holders`)

  // Calculate score
  let score = 0
  score += risks.length * 25
  score += warnings.length * 8
  score = Math.min(score, 100)

  const riskLevel: GoPlusRiskSummary['riskLevel'] =
    risks.length > 0 ? 'critical' :
    score >= 40       ? 'high' :
    score >= 20       ? 'medium' :
    score > 0         ? 'low' : 'safe'

  return { riskLevel, riskScore: score, risks, warnings, info }
}

// ── Combined: fetch + analyze ───────────────────────────────────
export async function auditToken(address: string): Promise<GoPlusRiskSummary | null> {
  const data = await getTokenSecurity(address)
  if (!data) return null
  return analyzeRisks(data)
}
