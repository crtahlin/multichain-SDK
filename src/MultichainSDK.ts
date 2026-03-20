import { MultichainLibrary, xBZZ, xDAI } from '@upcoming/multichain-library'
import { Elliptic, Strings } from 'cafe-utility'
import { SUPPORTED_CHAINS, getStampCost } from './config'
import { ConfigurationError, PriceFetchError } from './errors'
import { createFundingFlow, createBatchFlow, executeFlow, executeBatchFlow } from './flows/EvmToGnosisFlow'
import { RelayProvider } from './providers/RelayProvider'
import type {
  BatchRequest,
  BatchResult,
  ChainInfo,
  EvmWalletAdapter,
  MultichainSDKOptions,
  QuoteRequest,
  SwapCallbacks,
  SwapQuote,
  SwapRequest,
  SwapResult,
  TokenInfo,
} from './types'

/** Dummy address used for Relay quotes when no wallet is provided */
const DUMMY_SOURCE_ADDRESS = '0x0000000000000000000000000000000000000001' as `0x${string}`

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
   *
   * No wallet or private key is required — just specify the source chain, amounts,
   * and target address to get a price estimate. To execute the quote, pass it to
   * `executeSwap()` with a wallet.
   *
   * For a simpler one-step flow, use `swap()` instead.
   *
   * @example
   * ```typescript
   * // Wallet-free quote (just a price check)
   * const quote = await sdk.getQuote({
   *   sourceChain: 8453,
   *   targetAddress: '0xBeeNode...',
   *   bzzAmount: 10,
   *   nativeAmount: 0.5,
   * })
   * console.log(`Cost: $${quote.estimatedUsdValue.toFixed(2)}`)
   * ```
   *
   * @throws {ConfigurationError} If the source chain is unsupported or amounts are invalid
   * @throws {PriceFetchError} If the BZZ price API is unavailable
   * @throws {NoRouteError} If Relay Protocol finds no route for the swap
   */
  async getQuote(request: QuoteRequest): Promise<SwapQuote> {
    this.validateQuoteRequest(request)

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
    const sourceAddress = 'wallet' in request
      ? await (request as SwapRequest).wallet.getAddress()
      : DUMMY_SOURCE_ADDRESS

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
   *
   * Use this after `getQuote()` when you want to preview costs before executing.
   * The quote contains the Relay Protocol quote object and temporary wallet — both
   * are consumed during execution. Do not reuse a quote after execution.
   *
   * @param quote - Quote from `getQuote()`
   * @param wallet - The same wallet adapter used to obtain the quote
   * @param callbacks - Optional progress callbacks
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
   *
   * Equivalent to calling `getQuote()` followed by `executeSwap()`.
   * Use this when you don't need to preview costs before executing.
   *
   * @throws {ConfigurationError} If the source chain is unsupported or amounts are invalid
   * @throws {PriceFetchError} If the BZZ price API is unavailable
   * @throws {NoRouteError} If Relay Protocol finds no route for the swap
   */
  async swap(request: SwapRequest, callbacks?: SwapCallbacks): Promise<SwapResult> {
    this.validateSwapAmounts(request)
    const quote = await this.getQuote(request)
    return this.executeSwap(quote, request.wallet, callbacks)
  }

  /**
   * Cross-chain swap + Swarm postage batch creation in one operation.
   *
   * The SDK auto-calculates the required xBZZ from `batchDepth` and `batchDurationDays`
   * using the current Gnosis storage price. You only need to specify how much storage
   * you want and for how long.
   *
   * @throws {ConfigurationError} If the source chain is unsupported
   * @throws {PriceFetchError} If BZZ or storage price APIs are unavailable
   * @throws {NoRouteError} If Relay Protocol finds no route for the swap
   */
  async createBatch(request: BatchRequest, callbacks?: SwapCallbacks): Promise<BatchResult> {
    this.validateChainAndAmountSigns(request)

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

  /**
   * Get the current BZZ/USD price from the Gnosis chain price oracle.
   * @returns Price in USD per BZZ token (e.g. 0.35 means $0.35/BZZ)
   * @throws {PriceFetchError} If the price API is unavailable
   */
  async getBzzPrice(): Promise<number> {
    try {
      return await this.library.getGnosisBzzTokenPrice()
    } catch (error) {
      throw new PriceFetchError('BZZ price', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Get the current Gnosis storage price used for postage batch cost calculation.
   * @returns Storage price as a bigint (pass to `getStampCost()` for batch cost estimation)
   * @throws {PriceFetchError} If the price API is unavailable
   */
  async getStoragePrice(): Promise<bigint> {
    try {
      return await this.library.getStoragePriceGnosis()
    } catch (error) {
      throw new PriceFetchError('storage price', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Get the list of supported source chains.
   *
   * @example
   * ```typescript
   * const chains = sdk.getSupportedChains()
   * // [{ id: 1, name: 'Ethereum' }, { id: 137, name: 'Polygon' }, ...]
   * ```
   */
  getSupportedChains(): ChainInfo[] {
    return Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => ({
      id: Number(id) as ChainInfo['id'],
      name: chain.name,
    }))
  }

  /**
   * Get the list of tokens available for swapping on a given source chain.
   *
   * Queries the Relay Protocol API for verified tokens. Results include the
   * native token and popular ERC-20s (USDC, USDT, WETH, etc.).
   *
   * @param chainId - Source chain ID (e.g. 8453 for Base)
   * @throws {ConfigurationError} If the chain ID is not supported
   *
   * @example
   * ```typescript
   * const tokens = await sdk.getSupportedTokens(8453)
   * // [{ address: '0x000...', symbol: 'ETH', name: 'Ether', decimals: 18 }, ...]
   * ```
   */
  async getSupportedTokens(chainId: number): Promise<TokenInfo[]> {
    if (!(chainId in SUPPORTED_CHAINS)) {
      throw new ConfigurationError(
        `Unsupported chain: ${chainId}. Supported chains: ${this.getSupportedChains().map(c => `${c.id} (${c.name})`).join(', ')}.`
      )
    }
    return this.relayProvider.getTokens(chainId)
  }

  private validateQuoteRequest(request: QuoteRequest): void {
    if (!(request.sourceChain in SUPPORTED_CHAINS)) {
      throw new ConfigurationError(
        `Unsupported source chain: ${request.sourceChain}. Supported chains: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).`
      )
    }

    const bzzAmount = request.bzzAmount ?? 0
    const nativeAmount = request.nativeAmount ?? 0

    if (bzzAmount < 0) {
      throw new ConfigurationError('bzzAmount cannot be negative.')
    }
    if (nativeAmount < 0) {
      throw new ConfigurationError('nativeAmount cannot be negative.')
    }

    if (bzzAmount <= 0 && nativeAmount <= 0) {
      throw new ConfigurationError(
        'At least one of bzzAmount or nativeAmount must be greater than 0.'
      )
    }
  }

  private validateSwapAmounts(request: SwapRequest): void {
    this.validateQuoteRequest(request)
  }

  private validateChainAndAmountSigns(request: QuoteRequest): void {
    if (!(request.sourceChain in SUPPORTED_CHAINS)) {
      throw new ConfigurationError(
        `Unsupported source chain: ${request.sourceChain}. Supported chains: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).`
      )
    }
    if ((request.bzzAmount ?? 0) < 0) {
      throw new ConfigurationError('bzzAmount cannot be negative.')
    }
    if ((request.nativeAmount ?? 0) < 0) {
      throw new ConfigurationError('nativeAmount cannot be negative.')
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
