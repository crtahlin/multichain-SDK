import { createClient, Execute, RelayClient } from '@relayprotocol/relay-sdk'
import { MultichainLibrary, xDAI } from '@upcoming/multichain-library'
import { FixedPointNumber, Objects } from 'cafe-utility'
import { getRelayChains } from '../config'
import { NoRouteError } from '../errors'
import type { TokenInfo } from '../types'

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

  constructor(client?: RelayClient) {
    this.client = client ?? createClient({ chains: getRelayChains() })
  }

  getClient(): RelayClient {
    return this.client
  }

  async getTokens(chainId: number): Promise<TokenInfo[]> {
    const response = await fetch('https://api.relay.link/currencies/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainIds: [chainId], verified: true, limit: 100 }),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch tokens for chain ${chainId}: ${response.status} ${response.statusText}`)
    }

    const currencies = await response.json() as Array<{ address?: string; symbol?: string; name?: string; decimals?: number }>

    return currencies
      .filter((c): c is { address: string; symbol: string; name: string; decimals: number } =>
        typeof c.address === 'string' &&
        typeof c.symbol === 'string' &&
        typeof c.name === 'string' &&
        typeof c.decimals === 'number'
      )
      .map(c => ({ address: c.address, symbol: c.symbol, name: c.name, decimals: c.decimals }))
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
