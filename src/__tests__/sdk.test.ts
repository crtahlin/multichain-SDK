import { describe, expect, it, vi } from 'vitest'
import { MultichainSDK } from '../MultichainSDK'
import { ConfigurationError, PriceFetchError } from '../errors'
import type { EvmWalletAdapter, StepStatus } from '../types'

function createMockWallet(): EvmWalletAdapter {
  return {
    type: 'evm',
    getAddress: async () => '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
    getChainId: async () => 8453,
    sendTransaction: async () => '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
    getWalletClient: async () => ({} as any),
  }
}

describe('MultichainSDK', () => {
  describe('constructor', () => {
    it('creates instance with default options', () => {
      const sdk = new MultichainSDK()
      expect(sdk).toBeInstanceOf(MultichainSDK)
    })

    it('creates instance with mocked mode', () => {
      const sdk = new MultichainSDK({ mocked: true })
      expect(sdk).toBeInstanceOf(MultichainSDK)
    })
  })

  describe('swap (mocked)', () => {
    it('completes funding flow with all 6 steps', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const stepChanges: Record<string, StepStatus>[] = []

      const result = await sdk.swap(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 10,
          nativeAmount: 0.5,
        },
        {
          onStepChange: (steps) => {
            stepChanges.push({ ...steps })
          },
        },
      )

      expect(result.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)
      expect(result.temporaryAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(result.steps).toBeDefined()
      expect(result.metadata).toBeDefined()

      // Verify all 6 step names are present
      const stepNames = Object.keys(result.steps)
      expect(stepNames).toContain('relay')
      expect(stepNames).toContain('relay-sync')
      expect(stepNames).toContain('sushi')
      expect(stepNames).toContain('sushi-sync')
      expect(stepNames).toContain('transfer')
      expect(stepNames).toContain('transfer-sync')
    }, 30000)

    it('fires onStatusChange callbacks', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const statuses: string[] = []

      await sdk.swap(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 5,
        },
        {
          onStatusChange: (status) => {
            statuses.push(status)
          },
        },
      )

      expect(statuses).toContain('in-progress')
      expect(statuses).toContain('completed')
    }, 30000)
  })

  describe('createBatch (mocked)', () => {
    it('completes batch flow with 8 steps and returns batchId', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      const result = await sdk.createBatch(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          batchDepth: 20,
          batchDurationDays: 30,
        },
        {
          onBatchCreated: (data) => {
            expect(data.batchId).toBeDefined()
            expect(data.depth).toBe(20)
          },
        },
      )

      expect(result.batchId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(result.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)

      // Verify all 8 step names are present
      const stepNames = Object.keys(result.steps)
      expect(stepNames).toContain('relay')
      expect(stepNames).toContain('relay-sync')
      expect(stepNames).toContain('sushi')
      expect(stepNames).toContain('sushi-sync')
      expect(stepNames).toContain('approve-bzz')
      expect(stepNames).toContain('create-batch')
      expect(stepNames).toContain('transfer')
      expect(stepNames).toContain('transfer-sync')
    }, 30000)
  })

  describe('swap edge cases (mocked)', () => {
    it('completes with bzzAmount only (no nativeAmount)', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      const result = await sdk.swap({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        bzzAmount: 5,
      })

      expect(result.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)
      expect(result.steps).toBeDefined()
    }, 30000)

    it('completes with nativeAmount only (no bzzAmount)', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      const result = await sdk.swap({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        nativeAmount: 1.0,
      })

      expect(result.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)
      expect(result.steps).toBeDefined()
    }, 30000)

    it('generates unique temporary wallets per call', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const request = {
        wallet,
        sourceChain: 8453 as const,
        targetAddress: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        bzzAmount: 1,
      }

      const result1 = await sdk.swap(request)
      const result2 = await sdk.swap(request)

      expect(result1.temporaryPrivateKey).not.toBe(result2.temporaryPrivateKey)
      expect(result1.temporaryAddress).not.toBe(result2.temporaryAddress)
    }, 60000)

    it('works with all supported source chains', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      for (const chain of [1, 137, 10, 42161, 8453] as const) {
        const result = await sdk.swap({
          wallet,
          sourceChain: chain,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        })
        expect(result.steps).toBeDefined()
      }
    }, 120000)
  })

  describe('validation', () => {
    it('rejects unsupported source chain', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      await expect(
        sdk.swap({
          wallet,
          sourceChain: 999 as any,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('rejects when both amounts are zero', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      await expect(
        sdk.swap({
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 0,
          nativeAmount: 0,
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('rejects when no amounts specified', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      await expect(
        sdk.swap({
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('rejects negative bzzAmount', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      await expect(
        sdk.swap({
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: -5,
          nativeAmount: 0,
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('rejects negative nativeAmount', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      await expect(
        sdk.swap({
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 0,
          nativeAmount: -1,
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('error message lists supported chains', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      try {
        await sdk.swap({
          wallet,
          sourceChain: 56 as any,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        })
        expect.fail('should have thrown')
      } catch (error: any) {
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error.message).toContain('8453')
        expect(error.message).toContain('Base')
      }
    })

    it('createBatch skips amount validation (amounts derived from batch params)', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      // batchRequest can have bzzAmount=0, nativeAmount=0 because
      // the SDK calculates needed BZZ from batchDepth/batchDurationDays
      const result = await sdk.createBatch({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        batchDepth: 17,
        batchDurationDays: 1,
      })

      expect(result.batchId).toBeDefined()
    }, 30000)
  })

  describe('getQuote (wallet-free)', () => {
    it('works without a wallet', async () => {
      const sdk = new MultichainSDK()

      const quote = await sdk.getQuote({
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        bzzAmount: 10,
        nativeAmount: 0.5,
      })

      expect(quote.sourceTokenAmount).toBeDefined()
      expect(quote.estimatedUsdValue).toBeGreaterThan(0)
      expect(quote.bzzUsdPrice).toBeGreaterThan(0)
      expect(quote.temporaryAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(quote.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)
    }, 30000)

    it('works with nativeAmount only (no BZZ)', async () => {
      const sdk = new MultichainSDK()

      const quote = await sdk.getQuote({
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        nativeAmount: 1.0,
      })

      expect(quote.sourceTokenAmount).toBeDefined()
      expect(quote.bzzUsdPrice).toBe(0)
      expect(quote.bzzUsdValue).toBe(0)
      expect(quote.nativeAmount).toBe(1.0)
    }, 30000)

    it('still works when a wallet is provided (backwards compatible)', async () => {
      const sdk = new MultichainSDK()
      const wallet = createMockWallet()

      const quote = await sdk.getQuote({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        bzzAmount: 5,
      })

      expect(quote.sourceTokenAmount).toBeDefined()
      expect(quote.estimatedUsdValue).toBeGreaterThan(0)
    }, 30000)

    it('rejects unsupported chain without wallet', async () => {
      const sdk = new MultichainSDK()

      await expect(
        sdk.getQuote({
          sourceChain: 999 as any,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        }),
      ).rejects.toThrow(ConfigurationError)
    })

    it('rejects zero amounts without wallet', async () => {
      const sdk = new MultichainSDK()

      await expect(
        sdk.getQuote({
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
        }),
      ).rejects.toThrow(ConfigurationError)
    })
  })

  describe('getBzzPrice', () => {
    it('returns a positive number', async () => {
      const sdk = new MultichainSDK()
      const price = await sdk.getBzzPrice()
      expect(typeof price).toBe('number')
      expect(price).toBeGreaterThan(0)
    }, 30000)

    it('returns a reasonable price (< $1000)', async () => {
      const sdk = new MultichainSDK()
      const price = await sdk.getBzzPrice()
      expect(price).toBeLessThan(1000)
    }, 30000)
  })

  describe('getStoragePrice', () => {
    it('returns a bigint', async () => {
      const sdk = new MultichainSDK()
      const price = await sdk.getStoragePrice()
      expect(typeof price).toBe('bigint')
    }, 30000)

    it('returns a positive value', async () => {
      const sdk = new MultichainSDK()
      const price = await sdk.getStoragePrice()
      expect(price).toBeGreaterThan(0n)
    }, 30000)
  })

  describe('callback coverage (mocked)', () => {
    it('onStepChange receives all 6 step names for swap', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const seenSteps = new Set<string>()

      await sdk.swap(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        },
        {
          onStepChange: (steps) => {
            for (const name of Object.keys(steps)) {
              seenSteps.add(name)
            }
          },
        },
      )

      expect(seenSteps).toContain('relay')
      expect(seenSteps).toContain('relay-sync')
      expect(seenSteps).toContain('sushi')
      expect(seenSteps).toContain('sushi-sync')
      expect(seenSteps).toContain('transfer')
      expect(seenSteps).toContain('transfer-sync')
    }, 30000)

    it('onStepChange receives all 8 step names for createBatch', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const seenSteps = new Set<string>()

      await sdk.createBatch(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          batchDepth: 20,
          batchDurationDays: 30,
        },
        {
          onStepChange: (steps) => {
            for (const name of Object.keys(steps)) {
              seenSteps.add(name)
            }
          },
        },
      )

      expect(seenSteps).toContain('relay')
      expect(seenSteps).toContain('relay-sync')
      expect(seenSteps).toContain('sushi')
      expect(seenSteps).toContain('sushi-sync')
      expect(seenSteps).toContain('approve-bzz')
      expect(seenSteps).toContain('create-batch')
      expect(seenSteps).toContain('transfer')
      expect(seenSteps).toContain('transfer-sync')
    }, 30000)

    it('onStatusChange transitions through in-progress to completed for swap', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const statuses: string[] = []

      await sdk.swap(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          nativeAmount: 1,
        },
        {
          onStatusChange: (status) => { statuses.push(status) },
        },
      )

      expect(statuses.indexOf('in-progress')).toBeLessThan(statuses.indexOf('completed'))
    }, 30000)

    it('onBatchCreated receives correct batch data', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      let batchData: any = null

      await sdk.createBatch(
        {
          wallet,
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          batchDepth: 18,
          batchDurationDays: 7,
        },
        {
          onBatchCreated: (data) => { batchData = data },
        },
      )

      expect(batchData).not.toBeNull()
      expect(batchData.batchId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(batchData.depth).toBe(18)
      expect(typeof batchData.amount).toBe('string')
      expect(typeof batchData.blockNumber).toBe('string')
    }, 30000)

    it('swap works with no callbacks at all', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      const result = await sdk.swap({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        bzzAmount: 1,
      })

      expect(result.steps).toBeDefined()
      expect(result.temporaryPrivateKey).toMatch(/^0x[0-9a-f]{64}$/)
    }, 30000)

    it('createBatch works with no callbacks at all', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()

      const result = await sdk.createBatch({
        wallet,
        sourceChain: 8453,
        targetAddress: '0x1234567890123456789012345678901234567890',
        batchDepth: 20,
        batchDurationDays: 30,
      })

      expect(result.batchId).toMatch(/^0x[0-9a-f]{64}$/)
    }, 30000)
  })

  describe('getSupportedChains', () => {
    it('returns all 5 supported chains', () => {
      const sdk = new MultichainSDK()
      const chains = sdk.getSupportedChains()
      expect(chains).toHaveLength(5)
    })

    it('includes expected chain IDs', () => {
      const sdk = new MultichainSDK()
      const chains = sdk.getSupportedChains()
      const ids = chains.map(c => c.id)
      expect(ids).toContain(1)
      expect(ids).toContain(137)
      expect(ids).toContain(10)
      expect(ids).toContain(42161)
      expect(ids).toContain(8453)
    })

    it('returns id and name for each chain', () => {
      const sdk = new MultichainSDK()
      const chains = sdk.getSupportedChains()
      for (const chain of chains) {
        expect(typeof chain.id).toBe('number')
        expect(typeof chain.name).toBe('string')
        expect(chain.name.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getSupportedTokens', () => {
    it('returns tokens for Base', async () => {
      const sdk = new MultichainSDK()
      const tokens = await sdk.getSupportedTokens(8453)
      expect(tokens.length).toBeGreaterThan(0)
      for (const token of tokens) {
        expect(typeof token.address).toBe('string')
        expect(typeof token.symbol).toBe('string')
        expect(typeof token.name).toBe('string')
        expect(typeof token.decimals).toBe('number')
      }
    }, 30000)

    it('returns tokens for Ethereum', async () => {
      const sdk = new MultichainSDK()
      const tokens = await sdk.getSupportedTokens(1)
      expect(tokens.length).toBeGreaterThan(0)
    }, 30000)

    it('rejects unsupported chain ID', async () => {
      const sdk = new MultichainSDK()
      await expect(sdk.getSupportedTokens(999)).rejects.toThrow(ConfigurationError)
    })
  })

  describe('concurrent calls', () => {
    it('concurrent swaps generate unique temporary wallets', async () => {
      const sdk = new MultichainSDK({ mocked: true })
      const wallet = createMockWallet()
      const request = {
        wallet,
        sourceChain: 8453 as const,
        targetAddress: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        bzzAmount: 1,
      }

      const [r1, r2, r3] = await Promise.all([
        sdk.swap(request),
        sdk.swap(request),
        sdk.swap(request),
      ])

      const keys = new Set([r1.temporaryPrivateKey, r2.temporaryPrivateKey, r3.temporaryPrivateKey])
      expect(keys.size).toBe(3)

      const addrs = new Set([r1.temporaryAddress, r2.temporaryAddress, r3.temporaryAddress])
      expect(addrs.size).toBe(3)
    }, 60000)
  })
})
