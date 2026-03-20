import { Execute, RelayClient } from '@relayprotocol/relay-sdk'
import { MultichainLibrary } from '@upcoming/multichain-library'
import { FixedPointNumber, Solver } from 'cafe-utility'
import { WalletClient } from 'viem'
import type { SendTransactionSignature } from '../steps/RelayStep'
import { createRelayStep } from '../steps/RelayStep'
import { createRelaySyncStep } from '../steps/RelaySyncStep'
import { createSushiStep } from '../steps/SushiStep'
import { createSushiSyncStep } from '../steps/SushiSyncStep'
import { createTransferStep } from '../steps/TransferStep'
import { createTransferSyncStep } from '../steps/TransferSyncStep'
import { createApproveBzzStep } from '../steps/ApproveBzzStep'
import { createCreateBatchStep } from '../steps/CreateBatchStep'
import { createMockedRelayStep } from '../steps/MockedRelayStep'
import { createMockedRelaySyncStep } from '../steps/MockedRelaySyncStep'
import { createMockedSushiStep } from '../steps/MockedSushiStep'
import { createMockedSushiSyncStep } from '../steps/MockedSushiSyncStep'
import { createMockedTransferStep } from '../steps/MockedTransferStep'
import { createMockedTransferSyncStep } from '../steps/MockedTransferSyncStep'
import { createMockedApproveBzzStep } from '../steps/MockedApproveBzzStep'
import { createMockedCreateBatchStep } from '../steps/MockedCreateBatchStep'
import type { StepStatus, SwapCallbacks, SwapResult, BatchResult } from '../types'

interface FundingFlowOptions {
  library: MultichainLibrary
  sourceChain: number
  sourceToken: string
  sourceTokenAmount: FixedPointNumber
  totalDaiValue: FixedPointNumber
  bzzUsdValue: number
  temporaryAddress: `0x${string}`
  temporaryPrivateKey: `0x${string}`
  targetAddress: `0x${string}`
  sendTransactionAsync: SendTransactionSignature
  relayClient: RelayClient
  walletClient: WalletClient
  relayQuote: Execute
  mocked: boolean
  onMetadata: (key: string, value: string) => void
}

interface BatchFlowOptions extends FundingFlowOptions {
  batchAmount: string | bigint
  batchDepth: number
  onBatchCreated?: (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => void
}

export function createFundingFlow(options: FundingFlowOptions): Solver {
  const solver = new Solver()

  if (options.mocked) {
    solver.addStep(createMockedRelayStep())
    solver.addStep(createMockedRelaySyncStep())
    solver.addStep(createMockedSushiStep())
    solver.addStep(createMockedSushiSyncStep())
    solver.addStep(createMockedTransferStep())
    solver.addStep(createMockedTransferSyncStep())
  } else {
    solver.addStep(createRelayStep(options))
    solver.addStep(createRelaySyncStep(options))
    solver.addStep(createSushiStep(options))
    solver.addStep(createSushiSyncStep(options))
    solver.addStep(createTransferStep(options))
    solver.addStep(createTransferSyncStep(options))
  }

  return solver
}

export function createBatchFlow(options: BatchFlowOptions): Solver {
  const solver = new Solver()

  if (options.mocked) {
    solver.addStep(createMockedRelayStep())
    solver.addStep(createMockedRelaySyncStep())
    solver.addStep(createMockedSushiStep())
    solver.addStep(createMockedSushiSyncStep())
    solver.addStep(createMockedApproveBzzStep())
    solver.addStep(createMockedCreateBatchStep(options))
    solver.addStep(createMockedTransferStep())
    solver.addStep(createMockedTransferSyncStep())
  } else {
    solver.addStep(createRelayStep(options))
    solver.addStep(createRelaySyncStep(options))
    solver.addStep(createSushiStep({ ...options, targetAddress: options.temporaryAddress }))
    solver.addStep(createSushiSyncStep({ ...options, targetAddress: options.temporaryAddress }))
    solver.addStep(createApproveBzzStep(options))
    solver.addStep(createCreateBatchStep(options))
    solver.addStep(createTransferStep(options))
    solver.addStep(createTransferSyncStep(options))
  }

  return solver
}

export async function executeFlow(
  solver: Solver,
  options: { temporaryPrivateKey: `0x${string}`; temporaryAddress: `0x${string}` },
  callbacks?: SwapCallbacks,
): Promise<SwapResult> {
  const metadata: Record<string, string> = {}
  let stepStates: Record<string, StepStatus> = {}

  solver.setHooks({
    onStatusChange: async (newStatus) => {
      callbacks?.onStatusChange?.(newStatus as 'pending' | 'in-progress' | 'completed' | 'failed')
    },
    onStepChange: async (newStepStates) => {
      stepStates = newStepStates as Record<string, StepStatus>
      callbacks?.onStepChange?.(stepStates)
    },
    onError: async (error) => {
      callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)))
    },
    onFinish: async () => {},
  })

  await solver.execute()

  return {
    steps: stepStates,
    metadata,
    temporaryPrivateKey: options.temporaryPrivateKey,
    temporaryAddress: options.temporaryAddress,
  }
}

export async function executeBatchFlow(
  solver: Solver,
  options: { temporaryPrivateKey: `0x${string}`; temporaryAddress: `0x${string}` },
  callbacks?: SwapCallbacks,
): Promise<BatchResult> {
  const metadata: Record<string, string> = {}
  let stepStates: Record<string, StepStatus> = {}
  let batchId = ''
  let blockNumber = ''

  solver.setHooks({
    onStatusChange: async (newStatus) => {
      callbacks?.onStatusChange?.(newStatus as 'pending' | 'in-progress' | 'completed' | 'failed')
    },
    onStepChange: async (newStepStates) => {
      stepStates = newStepStates as Record<string, StepStatus>
      callbacks?.onStepChange?.(stepStates)
    },
    onError: async (error) => {
      callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)))
    },
    onFinish: async () => {},
  })

  const context = await solver.execute()

  if (context.has('batchId')) {
    batchId = context.get('batchId') as string
  }

  return {
    steps: stepStates,
    metadata,
    temporaryPrivateKey: options.temporaryPrivateKey,
    temporaryAddress: options.temporaryAddress,
    batchId,
    blockNumber,
  }
}
