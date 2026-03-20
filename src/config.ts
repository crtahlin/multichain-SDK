import { convertViemChainToRelayChain } from '@relayprotocol/relay-sdk'
import { FixedPointNumber } from 'cafe-utility'
import { type Chain } from 'viem'
import { arbitrum, base, gnosis, mainnet, optimism, polygon } from 'viem/chains'
import type { SupportedChainId } from './types'

/** Supported source chains mapped to viem Chain objects */
export const SUPPORTED_CHAINS: Record<SupportedChainId, Chain> = {
  1: mainnet,
  137: polygon,
  10: optimism,
  42161: arbitrum,
  8453: base,
}

/** Default RPC URLs for each chain (matching widget defaults) */
export const DEFAULT_RPC_URLS: Record<SupportedChainId | 100, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  137: 'https://polygon.drpc.org',
  10: 'https://optimism.drpc.org',
  42161: 'https://arbitrum.drpc.org',
  8453: 'https://base.drpc.org',
  100: 'https://xdai.fairdatasociety.org',
}

/** Block explorer base URLs */
const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  100: 'https://gnosisscan.io',
  137: 'https://polygonscan.com',
  10: 'https://optimistic.etherscan.io',
  42161: 'https://arbiscan.io',
  8453: 'https://basescan.org',
}

/** Build a full explorer transaction URL */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const base = EXPLORER_URLS[chainId] || 'https://etherscan.io'
  return `${base}/tx/${txHash}`
}

/** Get Relay Protocol chain configurations */
export function getRelayChains() {
  return [mainnet, polygon, optimism, arbitrum, base, gnosis].map(convertViemChainToRelayChain)
}

/** Stamp cost calculation result */
export interface StampCost {
  bzz: FixedPointNumber
  amount: bigint
}

/**
 * Calculate the cost of a postage batch.
 * Adapted from widget's Utility.ts.
 */
export function getStampCost(depth: number, days: number, storagePrice: bigint): StampCost {
  const amount = (BigInt(days * 86_400) / BigInt(5)) * storagePrice + 1n
  return {
    bzz: new FixedPointNumber(2n ** BigInt(depth) * BigInt(amount), 16),
    amount,
  }
}
