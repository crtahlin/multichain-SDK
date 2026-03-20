import { describe, expect, it } from 'vitest'
import { FixedPointNumber } from 'cafe-utility'
import {
  createFundingFlow,
  createBatchFlow,
  executeFlow,
  executeBatchFlow,
} from '../flows/EvmToGnosisFlow'
import type { StepStatus } from '../types'

// Minimal options to construct flows — only mocked mode is used so most fields
// can be stubs since mocked steps don't touch them.
function createMockFlowOptions(overrides?: Record<string, any>) {
  return {
    library: {} as any,
    sourceChain: 8453,
    sourceToken: '0x0000000000000000000000000000000000000000',
    sourceTokenAmount: new FixedPointNumber(0n, 18),
    totalDaiValue: new FixedPointNumber(0n, 18),
    bzzUsdValue: 10,
    temporaryAddress: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`,
    targetAddress: '0x2222222222222222222222222222222222222222' as `0x${string}`,
    sendTransactionAsync: async () => '0x0000' as `0x${string}`,
    relayClient: {} as any,
    walletClient: {} as any,
    relayQuote: {} as any,
    mocked: true,
    onMetadata: () => {},
    ...overrides,
  }
}

describe('EvmToGnosisFlow', () => {
  describe('createFundingFlow', () => {
    it('executes mocked funding flow with 6 steps', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const result = await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      const stepNames = Object.keys(result.steps)
      expect(stepNames).toHaveLength(6)
      expect(stepNames).toEqual(['relay', 'relay-sync', 'sushi', 'sushi-sync', 'transfer', 'transfer-sync'])
    }, 30000)

    it('all steps complete successfully in mocked mode', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const result = await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      for (const [name, status] of Object.entries(result.steps)) {
        expect(status).toBe('completed')
      }
    }, 30000)

    it('returns correct temporaryPrivateKey and temporaryAddress', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const result = await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          temporaryAddress: '0x3333333333333333333333333333333333333333',
        },
      )

      expect(result.temporaryPrivateKey).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      expect(result.temporaryAddress).toBe('0x3333333333333333333333333333333333333333')
    }, 30000)
  })

  describe('createBatchFlow', () => {
    it('executes mocked batch flow with 8 steps', async () => {
      const solver = createBatchFlow({
        ...createMockFlowOptions(),
        batchAmount: '1000000000',
        batchDepth: 20,
      })
      const result = await executeBatchFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      const stepNames = Object.keys(result.steps)
      expect(stepNames).toHaveLength(8)
      expect(stepNames).toEqual([
        'relay', 'relay-sync', 'sushi', 'sushi-sync',
        'approve-bzz', 'create-batch', 'transfer', 'transfer-sync',
      ])
    }, 30000)

    it('all batch steps complete successfully', async () => {
      const solver = createBatchFlow({
        ...createMockFlowOptions(),
        batchAmount: '1000000000',
        batchDepth: 20,
      })
      const result = await executeBatchFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      for (const status of Object.values(result.steps)) {
        expect(status).toBe('completed')
      }
    }, 30000)

    it('returns batchId from context', async () => {
      const solver = createBatchFlow({
        ...createMockFlowOptions(),
        batchAmount: '1000000000',
        batchDepth: 20,
      })
      const result = await executeBatchFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      expect(result.batchId).toMatch(/^0x[0-9a-f]{64}$/)
    }, 30000)

    it('fires onBatchCreated callback', async () => {
      let batchData: any = null
      const solver = createBatchFlow({
        ...createMockFlowOptions(),
        batchAmount: '1000000000',
        batchDepth: 20,
        onBatchCreated: (data: any) => { batchData = data },
      })

      await executeBatchFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      expect(batchData).not.toBeNull()
      expect(batchData.batchId).toMatch(/^0x[0-9a-f]{64}$/)
      expect(batchData.depth).toBe(20)
      expect(batchData.amount).toBe('1000000000')
      expect(batchData.blockNumber).toBeDefined()
    }, 30000)
  })

  describe('callback propagation', () => {
    it('onStatusChange fires with in-progress and completed', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const statuses: string[] = []

      await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
        {
          onStatusChange: (status) => { statuses.push(status) },
        },
      )

      expect(statuses).toContain('in-progress')
      expect(statuses).toContain('completed')
    }, 30000)

    it('onStepChange fires with step state snapshots', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const snapshots: Record<string, StepStatus>[] = []

      await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
        {
          onStepChange: (steps) => { snapshots.push({ ...steps }) },
        },
      )

      expect(snapshots.length).toBeGreaterThan(0)
      // Final snapshot should have all steps completed
      const last = snapshots[snapshots.length - 1]
      expect(Object.keys(last)).toHaveLength(6)
    }, 30000)

    it('executeFlow returns metadata object', async () => {
      const solver = createFundingFlow(createMockFlowOptions())
      const result = await executeFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      expect(result.metadata).toBeDefined()
      expect(typeof result.metadata).toBe('object')
    }, 30000)

    it('executeBatchFlow returns metadata and batch fields', async () => {
      const solver = createBatchFlow({
        ...createMockFlowOptions(),
        batchAmount: '999',
        batchDepth: 17,
      })
      const result = await executeBatchFlow(
        solver,
        {
          temporaryPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          temporaryAddress: '0x1111111111111111111111111111111111111111',
        },
      )

      expect(result.metadata).toBeDefined()
      expect(result.batchId).toBeDefined()
      expect(typeof result.blockNumber).toBe('string')
    }, 30000)
  })
})
