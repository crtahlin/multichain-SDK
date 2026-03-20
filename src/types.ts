import type { Execute } from '@relayprotocol/relay-sdk'
import type { MultichainLibrarySettings } from '@upcoming/multichain-library'
import type { FixedPointNumber } from 'cafe-utility'
import type { WalletClient } from 'viem'

/**
 * Supported EVM source chains.
 * Destination is always Gnosis (100).
 */
export type SupportedChainId = 1 | 137 | 10 | 42161 | 8453

/** Status of an individual step in a flow */
export type StepStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped'

/**
 * Minimal wallet interface that any EVM wallet provider can implement.
 *
 * Compatible with Coinbase AgentKit, Turnkey, Lit Protocol, Privy,
 * raw private keys, or any viem WalletClient.
 */
export interface EvmWalletAdapter {
  type: 'evm'
  getAddress(): Promise<`0x${string}`>
  getChainId(): Promise<number>
  sendTransaction(tx: { to: `0x${string}`; value: bigint }): Promise<`0x${string}`>
  getWalletClient(): Promise<WalletClient>
}

/**
 * Request for a price quote — no wallet required.
 *
 * Use this with `sdk.getQuote()` to preview costs before committing funds.
 * At least one of `bzzAmount` or `nativeAmount` must be > 0. Both must be non-negative.
 *
 * @example
 * ```typescript
 * const quote = await sdk.getQuote({
 *   sourceChain: 8453,
 *   targetAddress: '0xBeeNode...',
 *   bzzAmount: 10,
 *   nativeAmount: 0.5,
 * })
 * console.log(`Cost: $${quote.estimatedUsdValue.toFixed(2)}`)
 * ```
 */
export interface QuoteRequest {
  /** Source chain ID (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base) */
  sourceChain: SupportedChainId
  /** Gnosis address to receive xBZZ and/or xDAI */
  targetAddress: `0x${string}`
  /** Amount of xBZZ to deliver (in whole BZZ units, e.g. 10 = 10 BZZ). Defaults to 0. Must be >= 0. */
  bzzAmount?: number
  /** Amount of xDAI to deliver (in whole DAI units, e.g. 0.5 = 0.5 xDAI). Defaults to 0. Must be >= 0. */
  nativeAmount?: number
  /** Source token address. Defaults to native token (ETH/MATIC/etc.). Most agents leave this unset. */
  sourceToken?: `0x${string}`
}

/**
 * Request to swap tokens cross-chain and deliver xBZZ and/or xDAI to a target address on Gnosis.
 *
 * At least one of `bzzAmount` or `nativeAmount` must be > 0. Both must be non-negative.
 * Three use cases:
 * - **xBZZ + xDAI:** Set both `bzzAmount` and `nativeAmount`
 * - **xDAI only:** Set only `nativeAmount` (e.g., for chequebook funding)
 * - **xBZZ only:** Set only `bzzAmount`
 *
 * The SDK bridges source tokens from the source chain to Gnosis via Relay Protocol,
 * swaps to xBZZ via SushiSwap if needed, and transfers remaining xDAI to the target.
 * A 10% slippage buffer is included in the bridge amount.
 */
export interface SwapRequest extends QuoteRequest {
  /** Wallet adapter providing the source funds */
  wallet: EvmWalletAdapter
}

/**
 * Request to swap tokens cross-chain and create a Swarm postage batch.
 *
 * The SDK auto-calculates the required xBZZ from `batchDepth` and `batchDurationDays`
 * using the current storage price. You don't need to set `bzzAmount` — it's derived
 * from the batch parameters.
 *
 * `batchDepth` determines storage capacity:
 * - 17: ~44 kB
 * - 18: ~6.6 MB
 * - 19: ~111 MB
 * - 20: ~682 MB (recommended default)
 * - 21: ~2.6 GB
 * - 22: ~7.7 GB
 * - 23: ~19.8 GB
 * - 24: ~46.7 GB
 *
 * You can optionally set `nativeAmount` to deliver extra xDAI alongside the batch.
 */
export interface BatchRequest extends SwapRequest {
  /** Batch depth (17–24). Higher depth = more storage capacity. Recommended: 20. */
  batchDepth: number
  /** How long the batch should last, in days. */
  batchDurationDays: number
}

/**
 * Quote for a cross-chain swap, returned by `sdk.getQuote()`.
 *
 * Contains the estimated cost and a Relay Protocol quote object.
 * Pass this to `sdk.executeSwap()` to execute. Quotes are time-sensitive —
 * execute promptly after obtaining.
 */
export interface SwapQuote {
  /** Opaque Relay Protocol quote object. Pass to `executeSwap()` to execute. */
  relayQuote: Execute
  /** Amount of source tokens needed on the source chain */
  sourceTokenAmount: FixedPointNumber
  /** Estimated total USD value of the swap (from Relay's amountUsd field) */
  estimatedUsdValue: number
  /** Total xDAI value being bridged to Gnosis (includes 10% slippage buffer) */
  totalDaiValue: FixedPointNumber
  /** BZZ/USD price used for this quote (0 if no BZZ requested) */
  bzzUsdPrice: number
  /** USD value of the BZZ portion (0 if no BZZ requested) */
  bzzUsdValue: number
  /** Native (xDAI) amount requested */
  nativeAmount: number
  /** Temporary address on Gnosis that receives bridged funds */
  temporaryAddress: `0x${string}`
  /** Private key for the temporary address. Save this for fund recovery if the flow fails. */
  temporaryPrivateKey: `0x${string}`
  /** The original quote request parameters */
  request: QuoteRequest
}

/**
 * Result of a completed swap operation.
 *
 * If the flow failed mid-execution, use `temporaryPrivateKey` to access
 * the ephemeral Gnosis wallet and recover any bridged funds.
 */
export interface SwapResult {
  /** Step status map (step name -> final status). E.g. `{ relay: 'completed', sushi: 'completed', ... }` */
  steps: Record<string, StepStatus>
  /** Metadata collected during execution (e.g. explorer URLs for each transaction) */
  metadata: Record<string, string>
  /** Temporary wallet private key — save this to recover funds if the flow failed mid-execution */
  temporaryPrivateKey: `0x${string}`
  /** Temporary wallet address on Gnosis */
  temporaryAddress: `0x${string}`
}

/**
 * Result of a completed batch creation operation.
 * Extends SwapResult with batch-specific fields.
 */
export interface BatchResult extends SwapResult {
  /** Created postage batch ID (hex string, e.g. `0xabc123...`) */
  batchId: string
  /** Block number where the batch was created (hex string) */
  blockNumber: string
}

/**
 * Callbacks for monitoring swap/batch execution progress.
 * All callbacks are optional — `await sdk.swap(request)` works without them.
 */
export interface SwapCallbacks {
  /** Called when overall flow status changes (pending -> in-progress -> completed/failed) */
  onStatusChange?: (status: 'pending' | 'in-progress' | 'completed' | 'failed') => void
  /** Called when individual step statuses change. Keys are step names (e.g. 'relay', 'sushi'). */
  onStepChange?: (steps: Record<string, StepStatus>) => void
  /** Called when a step produces metadata (e.g. `onMetadata('relay', 'https://basescan.org/tx/0x...')`) */
  onMetadata?: (key: string, value: string) => void
  /** Called when a step encounters an error */
  onError?: (error: Error) => void
  /** Called when a postage batch is created (batch mode only). Not called for regular swaps. */
  onBatchCreated?: (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => void
}

/**
 * Options for constructing a MultichainSDK instance.
 *
 * @example
 * ```typescript
 * // Default configuration (live mode)
 * const sdk = new MultichainSDK()
 *
 * // Mocked mode for testing (no real transactions)
 * const sdk = new MultichainSDK({ mocked: true })
 *
 * // Custom library settings
 * const sdk = new MultichainSDK({ librarySettings: { gnosisRpcUrl: 'https://...' } })
 * ```
 */
export interface MultichainSDKOptions {
  /** Custom RPC URLs per chain. Keys are chain IDs (1, 137, 10, 42161, 8453, 100 for Gnosis). */
  rpcUrls?: Partial<Record<SupportedChainId | 100, string>>
  /** Settings passed to @upcoming/multichain-library (e.g. custom Gnosis RPC URL) */
  librarySettings?: Partial<MultichainLibrarySettings>
  /** Use mocked steps that simulate execution without real blockchain transactions. Useful for testing and demos. */
  mocked?: boolean
}
