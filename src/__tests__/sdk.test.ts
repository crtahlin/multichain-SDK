import { describe, expect, it, vi } from 'vitest'
import { MultichainSDK } from '../MultichainSDK'
import { ConfigurationError } from '../errors'
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
  })
})
