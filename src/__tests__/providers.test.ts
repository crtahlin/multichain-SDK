import { describe, expect, it } from 'vitest'
import type { RelayClient } from '@relayprotocol/relay-sdk'
import { RelayProvider } from '../providers/RelayProvider'
import { NoRouteError } from '../errors'

async function getLibrary() {
  const { MultichainLibrary } = await import('@upcoming/multichain-library')
  return new MultichainLibrary()
}

function createMockClient(getQuoteFn: (params: any) => Promise<any>): RelayClient {
  return {
    actions: { getQuote: getQuoteFn },
  } as unknown as RelayClient
}

const DUMMY_PARAMS = {
  sourceAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  temporaryAddress: '0x1234567890123456789012345678901234567890' as `0x${string}`,
  sourceChain: 8453,
  sourceToken: '0x0000000000000000000000000000000000000000',
  totalNeededUsdValue: 10,
}

describe('RelayProvider', () => {
  describe('construction', () => {
    it('constructs with default client', () => {
      const provider = new RelayProvider()
      expect(provider).toBeInstanceOf(RelayProvider)
    })

    it('constructs with injected client', () => {
      const client = createMockClient(async () => ({ details: {} }))
      const provider = new RelayProvider(client)
      expect(provider).toBeInstanceOf(RelayProvider)
    })

    it('getClient() returns the injected client', () => {
      const client = createMockClient(async () => ({ details: {} }))
      const provider = new RelayProvider(client)
      expect(provider.getClient()).toBe(client)
    })

    it('getClient() returns a client with actions', () => {
      const provider = new RelayProvider()
      const client = provider.getClient()
      expect(client).toBeDefined()
      expect(client.actions).toBeDefined()
      expect(typeof client.actions.getQuote).toBe('function')
    })
  })

  describe('getQuote error handling', () => {
    it('maps "no routes found" error to NoRouteError', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => { throw new Error('no routes found') }),
      )

      await expect(
        provider.getQuote({ ...DUMMY_PARAMS, library }),
      ).rejects.toThrow(NoRouteError)
    })

    it('NoRouteError preserves cause', async () => {
      const library = await getLibrary()
      const originalError = new Error('no routes found')
      const provider = new RelayProvider(
        createMockClient(async () => { throw originalError }),
      )

      try {
        await provider.getQuote({ ...DUMMY_PARAMS, library })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error).toBeInstanceOf(NoRouteError)
        expect(error.code).toBe('NO_ROUTE')
        expect(error.cause).toBe(originalError)
      }
    })

    it('NoRouteError includes source chain in message', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => { throw new Error('no routes found') }),
      )

      try {
        await provider.getQuote({ ...DUMMY_PARAMS, sourceChain: 42161, library })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error).toBeInstanceOf(NoRouteError)
        expect(error.message).toContain('42161')
      }
    })

    it('re-throws non-route errors as-is', async () => {
      const library = await getLibrary()
      const networkError = new Error('network timeout')
      const provider = new RelayProvider(
        createMockClient(async () => { throw networkError }),
      )

      await expect(
        provider.getQuote({ ...DUMMY_PARAMS, library }),
      ).rejects.toThrow(networkError)
    })

    it('does not wrap non-route errors in NoRouteError', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => { throw new Error('server error 500') }),
      )

      try {
        await provider.getQuote({ ...DUMMY_PARAMS, library })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error).not.toBeInstanceOf(NoRouteError)
        expect(error.message).toBe('server error 500')
      }
    })
  })

  describe('getQuote response parsing', () => {
    it('parses sourceTokenAmount from currencyIn', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({
          details: {
            currencyIn: {
              amount: '1000000000000000000',
              currency: { decimals: 18 },
              amountUsd: '3.50',
            },
          },
        })),
      )

      const result = await provider.getQuote({ ...DUMMY_PARAMS, library })
      expect(result.sourceTokenAmount.toFloat()).toBeCloseTo(1.0)
      expect(result.relayQuote).toBeDefined()
      expect(result.totalDaiValue).toBeDefined()
    })

    it('returns zero sourceTokenAmount when currencyIn is missing', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({ details: {} })),
      )

      const result = await provider.getQuote({ ...DUMMY_PARAMS, library })
      expect(result.sourceTokenAmount.toFloat()).toBe(0)
    })

    it('returns zero sourceTokenAmount when amount is missing', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({
          details: { currencyIn: { currency: { decimals: 18 } } },
        })),
      )

      const result = await provider.getQuote({ ...DUMMY_PARAMS, library })
      expect(result.sourceTokenAmount.toFloat()).toBe(0)
    })

    it('handles 6-decimal tokens (USDC)', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({
          details: {
            currencyIn: {
              amount: '5000000',
              currency: { decimals: 6 },
            },
          },
        })),
      )

      const result = await provider.getQuote({ ...DUMMY_PARAMS, library })
      expect(result.sourceTokenAmount.toFloat()).toBeCloseTo(5.0)
    })

    it('handles 8-decimal tokens (WBTC)', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({
          details: {
            currencyIn: {
              amount: '100000000',
              currency: { decimals: 8 },
            },
          },
        })),
      )

      const result = await provider.getQuote({ ...DUMMY_PARAMS, library })
      expect(result.sourceTokenAmount.toFloat()).toBeCloseTo(1.0)
    })

    it('totalDaiValue reflects totalNeededUsdValue', async () => {
      const library = await getLibrary()
      const provider = new RelayProvider(
        createMockClient(async () => ({ details: {} })),
      )

      const result = await provider.getQuote({
        ...DUMMY_PARAMS,
        totalNeededUsdValue: 25.5,
        library,
      })

      expect(result.totalDaiValue.toFloat()).toBeCloseTo(25.5, 0)
    })
  })

  describe('getQuote parameter construction', () => {
    it('passes correct parameters to Relay SDK', async () => {
      const library = await getLibrary()
      let capturedParams: any = null

      const provider = new RelayProvider(
        createMockClient(async (params) => {
          capturedParams = params
          return { details: {} }
        }),
      )

      await provider.getQuote({ ...DUMMY_PARAMS, library })

      expect(capturedParams).not.toBeNull()
      expect(capturedParams.user).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
      expect(capturedParams.recipient).toBe('0x1234567890123456789012345678901234567890')
      expect(capturedParams.chainId).toBe(8453)
      expect(capturedParams.toChainId).toBe(100)
      expect(capturedParams.tradeType).toBe('EXACT_OUTPUT')
      expect(capturedParams.toCurrency).toBe(library.constants.nullAddress)
      expect(capturedParams.currency).toBe('0x0000000000000000000000000000000000000000')
    })

    it('uses provided source token', async () => {
      const library = await getLibrary()
      let capturedParams: any = null

      const provider = new RelayProvider(
        createMockClient(async (params) => {
          capturedParams = params
          return { details: {} }
        }),
      )

      await provider.getQuote({
        ...DUMMY_PARAMS,
        sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        library,
      })

      expect(capturedParams.currency).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    })

    it('amount is a string representation of totalDaiValue', async () => {
      const library = await getLibrary()
      let capturedParams: any = null

      const provider = new RelayProvider(
        createMockClient(async (params) => {
          capturedParams = params
          return { details: {} }
        }),
      )

      await provider.getQuote({
        ...DUMMY_PARAMS,
        totalNeededUsdValue: 15.0,
        library,
      })

      expect(typeof capturedParams.amount).toBe('string')
      expect(BigInt(capturedParams.amount)).toBeGreaterThan(0n)
    })
  })
})
