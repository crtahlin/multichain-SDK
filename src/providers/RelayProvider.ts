import { createClient, Execute, RelayClient } from '@relayprotocol/relay-sdk'
import { MultichainLibrary, xDAI } from '@upcoming/multichain-library'
import { FixedPointNumber, Objects } from 'cafe-utility'
import { getRelayChains } from '../config'
import { NoRouteError } from '../errors'

interface QuoteParams {
  sourceAddress: `0x${string}`
  temporaryAddress: `0x${string}`
  sourceChain: number
  sourceToken: string
  totalNeededUsdValue: number
  library: MultichainLibrary
}

interface QuoteResult {
  relayQuote: Execute
  sourceTokenAmount: FixedPointNumber
  totalDaiValue: FixedPointNumber
}

export class RelayProvider {
  private client: RelayClient

  constructor() {
    this.client = createClient({ chains: getRelayChains() })
  }

  getClient(): RelayClient {
    return this.client
  }

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const totalDaiValue = xDAI.fromFloat(params.totalNeededUsdValue)
    const quoteConfiguration = {
      user: params.sourceAddress,
      recipient: params.temporaryAddress,
      chainId: params.sourceChain,
      toChainId: params.library.constants.gnosisChainId,
      currency: params.sourceToken,
      toCurrency: params.library.constants.nullAddress,
      tradeType: 'EXACT_OUTPUT' as const,
      amount: totalDaiValue.toString(),
    }

    try {
      const quote = await this.client.actions.getQuote(quoteConfiguration)
      const currencyIn = quote?.details?.currencyIn
      const sourceTokenAmount =
        currencyIn?.amount && currencyIn.currency?.decimals
          ? new FixedPointNumber(currencyIn.amount, currencyIn.currency.decimals)
          : new FixedPointNumber(0n, 18)

      return { relayQuote: quote, sourceTokenAmount, totalDaiValue }
    } catch (error: unknown) {
      if (Objects.errorMatches(error, 'no routes found')) {
        throw new NoRouteError(params.sourceChain, params.sourceToken, error instanceof Error ? error : undefined)
      }
      throw error
    }
  }
}
