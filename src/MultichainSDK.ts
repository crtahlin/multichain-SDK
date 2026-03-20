import { MultichainLibrary, xBZZ, xDAI } from '@upcoming/multichain-library'
import { Elliptic, Strings } from 'cafe-utility'
import { SUPPORTED_CHAINS, getStampCost } from './config'
import { ConfigurationError, PriceFetchError } from './errors'
import { createFundingFlow, createBatchFlow, executeFlow, executeBatchFlow } from './flows/EvmToGnosisFlow'
import { RelayProvider } from './providers/RelayProvider'
import type {
  BatchRequest,
  BatchResult,
  EvmWalletAdapter,
  MultichainSDKOptions,
  SwapCallbacks,
  SwapQuote,
  SwapRequest,
  SwapResult,
} from './types'

/**
 * Main SDK class for cross-chain swaps to Gnosis and Swarm postage batch creation.
 *
 * @example
 * ```typescript
 * import { MultichainSDK, EvmPrivateKeyWallet } from '@upcoming/multichain-sdk'
 *
 * const sdk = new MultichainSDK()
 * const wallet = new EvmPrivateKeyWallet({ privateKey: '0x...', chainId: 8453 })
 *
 * // Fund a wallet with xBZZ + xDAI
 * const result = await sdk.swap({
 *   wallet, sourceChain: 8453, targetAddress: '0xBeeNode...',
 *   bzzAmount: 10, nativeAmount: 0.5
 * })
 *
 * // Create a postage batch
 * const batch = await sdk.createBatch({
 *   wallet, sourceChain: 8453, targetAddress: '0xBeeNode...',
 *   batchDepth: 20, batchDurationDays: 30
 * })
 * ```
 */
export class MultichainSDK {
  private library: MultichainLibrary
  private relayProvider: RelayProvider
  private mocked: boolean

  constructor(options?: MultichainSDKOptions) {
    this.library = new MultichainLibrary(options?.librarySettings)
    this.relayProvider = new RelayProvider()
    this.mocked = options?.mocked ?? false
  }

  /**
   * Get a quote for a cross-chain swap without executing it.
   * Use this to preview costs before committing funds.
   */
  async getQuote(request: SwapRequest): Promise<SwapQuote> {
    this.validateRequest(request)

    const bzzAmount = request.bzzAmount ?? 0
    const nativeAmount = request.nativeAmount ?? 0
    const sourceToken = request.sourceToken ?? this.library.constants.nullAddress

    let bzzUsdPrice = 0
    let bzzUsdValue = 0
    if (bzzAmount > 0) {
      try {
        bzzUsdPrice = await this.library.getGnosisBzzTokenPrice()
      } catch (error) {
        throw new PriceFetchError('BZZ price', error instanceof Error ? error : undefined)
      }
      const neededBzz = xBZZ.fromFloat(bzzAmount)
      bzzUsdValue = neededBzz.toFloat() * bzzUsdPrice
    }

    const daiDust = this.library.constants.daiDustAmount.toFloat()
    const totalNeededUsdValue = (bzzUsdValue + nativeAmount + daiDust) * 1.1

    const { temporaryPrivateKey, temporaryAddress } = this.generateTemporaryWallet()
    const sourceAddress = await request.wallet.getAddress()

    const { relayQuote, sourceTokenAmount, totalDaiValue } = await this.relayProvider.getQuote({
      sourceAddress,
      temporaryAddress,
      sourceChain: request.sourceChain,
      sourceToken,
      totalNeededUsdValue,
      library: this.library,
    })

    const currencyIn = relayQuote?.details?.currencyIn
    const estimatedUsdValue =
      currencyIn?.amountUsd ? parseFloat(currencyIn.amountUsd) : sourceTokenAmount.toFloat()

    return {
      relayQuote,
      sourceTokenAmount,
      estimatedUsdValue,
      totalDaiValue,
      bzzUsdPrice,
      bzzUsdValue,
      nativeAmount,
      temporaryAddress,
      temporaryPrivateKey,
      request,
    }
  }

  /**
   * Execute a swap from a previously obtained quote.
   */
  async executeSwap(
    quote: SwapQuote,
    wallet: EvmWalletAdapter,
    callbacks?: SwapCallbacks,
  ): Promise<SwapResult> {
    const sourceToken = quote.request.sourceToken ?? this.library.constants.nullAddress
    const metadata: Record<string, string> = {}

    const onMetadata = (key: string, value: string) => {
      metadata[key] = value
      callbacks?.onMetadata?.(key, value)
    }

    const walletClient = await wallet.getWalletClient()
    const sendTransactionAsync = async (tx: { to: `0x${string}`; value: bigint }) => {
      return wallet.sendTransaction(tx)
    }

    const solver = createFundingFlow({
      library: this.library,
      relayQuote: quote.relayQuote,
      sourceChain: quote.request.sourceChain,
      sourceToken,
      sourceTokenAmount: quote.sourceTokenAmount,
      sendTransactionAsync,
      targetAddress: quote.request.targetAddress,
      temporaryAddress: quote.temporaryAddress,
      temporaryPrivateKey: quote.temporaryPrivateKey,
      bzzUsdValue: quote.bzzUsdValue,
      totalDaiValue: quote.totalDaiValue,
      relayClient: this.relayProvider.getClient(),
      walletClient,
      mocked: this.mocked,
      onMetadata,
    })

    const result = await executeFlow(
      solver,
      { temporaryPrivateKey: quote.temporaryPrivateKey, temporaryAddress: quote.temporaryAddress },
      callbacks,
    )
    result.metadata = { ...result.metadata, ...metadata }
    return result
  }

  /**
   * One-step convenience: quote and execute a swap in one call.
   * Delivers xBZZ and/or xDAI to the target address on Gnosis.
   */
  async swap(request: SwapRequest, callbacks?: SwapCallbacks): Promise<SwapResult> {
    const quote = await this.getQuote(request)
    return this.executeSwap(quote, request.wallet, callbacks)
  }

  /**
   * Cross-chain swap + Swarm postage batch creation in one operation.
   * SDK auto-calculates required xBZZ from batch parameters.
   */
  async createBatch(request: BatchRequest, callbacks?: SwapCallbacks): Promise<BatchResult> {
    this.validateRequest(request)

    const sourceToken = request.sourceToken ?? this.library.constants.nullAddress

    let bzzUsdPrice: number
    try {
      bzzUsdPrice = await this.library.getGnosisBzzTokenPrice()
    } catch (error) {
      throw new PriceFetchError('BZZ price', error instanceof Error ? error : undefined)
    }

    let storagePrice: bigint
    try {
      storagePrice = await this.library.getStoragePriceGnosis()
    } catch (error) {
      throw new PriceFetchError('storage price', error instanceof Error ? error : undefined)
    }

    const stampCost = getStampCost(request.batchDepth, request.batchDurationDays, storagePrice)
    const bzzUsdValue = stampCost.bzz.toFloat() * bzzUsdPrice
    const nativeAmount = request.nativeAmount ?? 0
    const daiDust = this.library.constants.daiDustAmount.toFloat()
    const totalNeededUsdValue = (bzzUsdValue + nativeAmount + daiDust) * 1.1

    const { temporaryPrivateKey, temporaryAddress } = this.generateTemporaryWallet()
    const sourceAddress = await request.wallet.getAddress()

    const { relayQuote, sourceTokenAmount, totalDaiValue } = await this.relayProvider.getQuote({
      sourceAddress,
      temporaryAddress,
      sourceChain: request.sourceChain,
      sourceToken,
      totalNeededUsdValue,
      library: this.library,
    })

    const walletClient = await request.wallet.getWalletClient()
    const sendTransactionAsync = async (tx: { to: `0x${string}`; value: bigint }) => {
      return request.wallet.sendTransaction(tx)
    }

    const metadata: Record<string, string> = {}
    const onMetadata = (key: string, value: string) => {
      metadata[key] = value
      callbacks?.onMetadata?.(key, value)
    }

    let batchResult: { batchId: string; depth: number; amount: string; blockNumber: string } | undefined
    const onBatchCreated = (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => {
      batchResult = data
      callbacks?.onBatchCreated?.(data)
    }

    const solver = createBatchFlow({
      library: this.library,
      relayQuote,
      sourceChain: request.sourceChain,
      sourceToken,
      sourceTokenAmount,
      sendTransactionAsync,
      targetAddress: request.targetAddress,
      temporaryAddress,
      temporaryPrivateKey,
      bzzUsdValue,
      totalDaiValue,
      relayClient: this.relayProvider.getClient(),
      walletClient,
      batchAmount: stampCost.amount,
      batchDepth: request.batchDepth,
      mocked: this.mocked,
      onMetadata,
      onBatchCreated,
    })

    const result = await executeBatchFlow(
      solver,
      { temporaryPrivateKey, temporaryAddress },
      callbacks,
    )
    result.metadata = { ...result.metadata, ...metadata }

    if (batchResult) {
      result.batchId = batchResult.batchId
      result.blockNumber = batchResult.blockNumber
    }

    return result
  }

  /** Get current BZZ/USD price */
  async getBzzPrice(): Promise<number> {
    try {
      return await this.library.getGnosisBzzTokenPrice()
    } catch (error) {
      throw new PriceFetchError('BZZ price', error instanceof Error ? error : undefined)
    }
  }

  /** Get current Gnosis storage price per block */
  async getStoragePrice(): Promise<bigint> {
    try {
      return await this.library.getStoragePriceGnosis()
    } catch (error) {
      throw new PriceFetchError('storage price', error instanceof Error ? error : undefined)
    }
  }

  private validateRequest(request: SwapRequest): void {
    if (!(request.sourceChain in SUPPORTED_CHAINS)) {
      throw new ConfigurationError(
        `Unsupported source chain: ${request.sourceChain}. Supported chains: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).`
      )
    }

    const bzzAmount = request.bzzAmount ?? 0
    const nativeAmount = request.nativeAmount ?? 0

    if ('batchDepth' in request) {
      // BatchRequest — amounts are calculated from batch params, skip amount check
      return
    }

    if (bzzAmount <= 0 && nativeAmount <= 0) {
      throw new ConfigurationError(
        'At least one of bzzAmount or nativeAmount must be greater than 0.'
      )
    }
  }

  private generateTemporaryWallet(): { temporaryPrivateKey: `0x${string}`; temporaryAddress: `0x${string}` } {
    const hex = Strings.randomHex(64)
    const privateKeyBigInt = BigInt(`0x${hex}`)
    const publicKey = Elliptic.privateKeyToPublicKey(privateKeyBigInt)
    const addressBytes = Elliptic.publicKeyToAddress(publicKey)
    const address = Elliptic.checksumEncode(addressBytes)
    return {
      temporaryPrivateKey: `0x${hex}`,
      temporaryAddress: address as `0x${string}`,
    }
  }
}
