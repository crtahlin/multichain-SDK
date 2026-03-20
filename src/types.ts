import type { Execute } from '@relayprotocol/relay-sdk'
import type { MultichainLibrarySettings } from '@upcoming/multichain-library'
import type { FixedPointNumber } from 'cafe-utility'
import type { WalletClient } from 'viem'

/** Supported EVM source chains */
export type SupportedChainId = 1 | 137 | 10 | 42161 | 8453

/** Status of an individual step in a flow */
export type StepStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped'

/** Minimal wallet interface that any EVM wallet provider can implement */
export interface EvmWalletAdapter {
  type: 'evm'
  getAddress(): Promise<`0x${string}`>
  getChainId(): Promise<number>
  sendTransaction(tx: { to: `0x${string}`; value: bigint }): Promise<`0x${string}`>
  getWalletClient(): Promise<WalletClient>
}

/**
 * Request to swap tokens cross-chain and deliver xBZZ and/or xDAI to a target address.
 * At least one of `bzzAmount` or `nativeAmount` must be > 0.
 */
export interface SwapRequest {
  /** Wallet adapter providing the source funds */
  wallet: EvmWalletAdapter
  /** Source chain ID (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base) */
  sourceChain: SupportedChainId
  /** Gnosis address to receive xBZZ and/or xDAI */
  targetAddress: `0x${string}`
  /** Amount of xBZZ to deliver (in BZZ units, e.g. 10 = 10 BZZ). Defaults to 0. */
  bzzAmount?: number
  /** Amount of xDAI to deliver (in DAI units, e.g. 0.5 = 0.5 DAI). Defaults to 0. */
  nativeAmount?: number
  /** Source token address. Defaults to native token (null address). */
  sourceToken?: `0x${string}`
}

/**
 * Request to swap tokens cross-chain and create a Swarm postage batch.
 * SDK auto-calculates required xBZZ from batch parameters.
 */
export interface BatchRequest extends SwapRequest {
  /** Batch depth (determines storage capacity) */
  batchDepth: number
  /** Batch duration in days */
  batchDurationDays: number
}

/** Quote for a cross-chain swap */
export interface SwapQuote {
  /** Opaque Relay Protocol quote object */
  relayQuote: Execute
  /** Amount of source tokens needed */
  sourceTokenAmount: FixedPointNumber
  /** Estimated USD value of the swap */
  estimatedUsdValue: number
  /** Total xDAI value being bridged (including slippage buffer) */
  totalDaiValue: FixedPointNumber
  /** Current BZZ/USD price */
  bzzUsdPrice: number
  /** BZZ USD value portion of the swap */
  bzzUsdValue: number
  /** Native (xDAI) amount requested */
  nativeAmount: number
  /** Temporary address on Gnosis that receives bridged funds */
  temporaryAddress: `0x${string}`
  /** Private key for the temporary address (for fund recovery) */
  temporaryPrivateKey: `0x${string}`
  /** The original swap request */
  request: SwapRequest
}

/** Result of a completed swap operation */
export interface SwapResult {
  /** Step status map (step name → final status) */
  steps: Record<string, StepStatus>
  /** Metadata collected during execution (explorer URLs, etc.) */
  metadata: Record<string, string>
  /** Temporary wallet private key (for fund recovery if flow failed) */
  temporaryPrivateKey: `0x${string}`
  /** Temporary wallet address */
  temporaryAddress: `0x${string}`
}

/** Result of a completed batch creation operation */
export interface BatchResult extends SwapResult {
  /** Created postage batch ID */
  batchId: string
  /** Block number where the batch was created */
  blockNumber: string
}

/** Callbacks for monitoring swap/batch execution progress */
export interface SwapCallbacks {
  /** Called when overall flow status changes */
  onStatusChange?: (status: 'pending' | 'in-progress' | 'completed' | 'failed') => void
  /** Called when individual step statuses change */
  onStepChange?: (steps: Record<string, StepStatus>) => void
  /** Called when a step produces metadata (e.g. explorer URLs) */
  onMetadata?: (key: string, value: string) => void
  /** Called when a step encounters an error */
  onError?: (error: Error) => void
  /** Called when a batch is created (batch mode only) */
  onBatchCreated?: (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => void
}

/** Options for constructing a MultichainSDK instance */
export interface MultichainSDKOptions {
  /** Custom RPC URLs per chain */
  rpcUrls?: Partial<Record<SupportedChainId | 100, string>>
  /** Settings passed to @upcoming/multichain-library */
  librarySettings?: Partial<MultichainLibrarySettings>
  /** Use mocked steps (no real blockchain transactions) */
  mocked?: boolean
}
