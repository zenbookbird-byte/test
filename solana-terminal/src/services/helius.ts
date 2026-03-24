// ═══════════════════════════════════════════════════════════════
// Helius Enhanced API — DAS, parsed transactions, webhooks
// https://docs.helius.dev
// ═══════════════════════════════════════════════════════════════

import { HELIUS_API_KEY, HELIUS_API_BASE, HELIUS_RPC_BASE, HAS_HELIUS, fetchWithRetry } from './apiConfig'

// ── Types ────────────────────────────────────────────────────────
export interface HeliusAsset {
  id: string
  content: {
    metadata: { name: string; symbol: string; description?: string }
    links?: { image?: string; external_url?: string }
    files?: { uri: string; mime: string }[]
  }
  token_info?: {
    price_info?: { price_per_token: number; total_price: number; currency: string }
    balance: number
    decimals: number
    supply: number
    symbol: string
    associated_token_address: string
  }
  ownership: { owner: string; frozen: boolean }
  authorities?: { address: string; scopes: string[] }[]
  compression?: { compressed: boolean }
  grouping?: { group_key: string; group_value: string }[]
  royalty?: { royalty_model: string; percent: number }
  creators?: { address: string; share: number; verified: boolean }[]
  mutable: boolean
  burnt: boolean
}

export interface HeliusParsedTx {
  signature: string
  timestamp: number
  type: string
  source: string
  fee: number
  feePayer: string
  description: string
  tokenTransfers: {
    fromUserAccount: string
    toUserAccount: string
    fromTokenAccount: string
    toTokenAccount: string
    tokenAmount: number
    mint: string
    tokenStandard: string
  }[]
  nativeTransfers: {
    fromUserAccount: string
    toUserAccount: string
    amount: number
  }[]
  accountData: {
    account: string
    nativeBalanceChange: number
    tokenBalanceChanges: {
      userAccount: string
      tokenAccount: string
      rawTokenAmount: { tokenAmount: string; decimals: number }
      mint: string
    }[]
  }[]
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string }
      nativeOutput?: { account: string; amount: string }
      tokenInputs: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[]
      tokenOutputs: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[]
      tokenFees: unknown[]
      innerSwaps: unknown[]
    }
  }
}

export interface HeliusTokenHolder {
  owner: string
  balance: number
  percentage: number
}

// ── Get assets by owner (DAS API) ──────────────────────────────
export async function getAssetsByOwner(wallet: string, page = 1, limit = 100): Promise<HeliusAsset[]> {
  if (!HAS_HELIUS) return []
  try {
    const r = await fetchWithRetry(HELIUS_RPC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'das-assets', method: 'getAssetsByOwner',
        params: { ownerAddress: wallet, page, limit, sortBy: { sortBy: 'recent_action', sortDirection: 'desc' },
          displayOptions: { showFungible: true, showNativeBalance: true } },
      }),
    })
    const json = await r.json() as { result?: { items: HeliusAsset[] } }
    return json.result?.items ?? []
  } catch { return [] }
}

// ── Get single asset metadata (DAS API) ──────────────────────────
export async function getAsset(mint: string): Promise<HeliusAsset | null> {
  if (!HAS_HELIUS) return null
  try {
    const r = await fetchWithRetry(HELIUS_RPC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'das-asset', method: 'getAsset',
        params: { id: mint, displayOptions: { showFungible: true } },
      }),
    })
    const json = await r.json() as { result?: HeliusAsset }
    return json.result ?? null
  } catch { return null }
}

// ── Parsed transaction history ──────────────────────────────────
export async function getParsedTransactions(wallet: string, limit = 20): Promise<HeliusParsedTx[]> {
  if (!HAS_HELIUS) return []
  try {
    const r = await fetchWithRetry(
      `${HELIUS_API_BASE}/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}&type=SWAP`
    )
    return await r.json() as HeliusParsedTx[]
  } catch { return [] }
}

// ── Get all parsed txns for a signature list ────────────────────
export async function parseTransactions(signatures: string[]): Promise<HeliusParsedTx[]> {
  if (!HAS_HELIUS || signatures.length === 0) return []
  try {
    const r = await fetchWithRetry(
      `${HELIUS_API_BASE}/transactions?api-key=${HELIUS_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: signatures }) },
    )
    return await r.json() as HeliusParsedTx[]
  } catch { return [] }
}

// ── Token holders (top holders of a mint) ───────────────────────
export async function getTokenLargestAccounts(mint: string): Promise<HeliusTokenHolder[]> {
  if (!HAS_HELIUS) return []
  try {
    const r = await fetchWithRetry(HELIUS_RPC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'holders', method: 'getTokenLargestAccounts',
        params: [mint],
      }),
    })
    const json = await r.json() as { result?: { value: { address: string; amount: string; decimals: number; uiAmount: number }[] } }
    const accounts = json.result?.value ?? []
    const total = accounts.reduce((s, a) => s + a.uiAmount, 0)
    return accounts.map(a => ({
      owner: a.address,
      balance: a.uiAmount,
      percentage: total > 0 ? (a.uiAmount / total) * 100 : 0,
    }))
  } catch { return [] }
}

// ── Enhanced websocket for real-time transaction stream ──────────
export function createTransactionStream(
  accounts: string[],
  onTransaction: (tx: HeliusParsedTx) => void,
): WebSocket | null {
  if (!HAS_HELIUS) return null
  const ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`)
  ws.onopen = () => {
    ws.send(JSON.stringify({
      jsonrpc: '2.0', id: 420, method: 'transactionSubscribe',
      params: [{
        accountInclude: accounts,
      }, {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        transactionDetails: 'full',
        maxSupportedTransactionVersion: 0,
      }],
    }))
  }
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.params?.result) onTransaction(data.params.result as HeliusParsedTx)
    } catch { /* skip */ }
  }
  return ws
}
