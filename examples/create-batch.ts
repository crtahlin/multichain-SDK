/**
 * Create Postage Batch — Cross-chain swap + Swarm batch creation in one operation
 *
 * This example demonstrates the batch creation flow: bridging tokens,
 * swapping to xBZZ, approving the postage stamp contract, creating the
 * batch, and transferring remaining xDAI to the target.
 *
 * The flow has 8 steps:
 *   1. Relay bridge (source chain → Gnosis xDAI)
 *   2. Wait for xDAI arrival
 *   3. SushiSwap xDAI → xBZZ (to temporary address for batch contract)
 *   4. Wait for xBZZ arrival
 *   5. Approve xBZZ for postage stamp contract
 *   6. Create postage batch
 *   7. Transfer remaining xDAI to target
 *   8. Wait for transfer confirmation
 *
 * The SDK auto-calculates the required xBZZ from batchDepth and
 * batchDurationDays — you just specify the desired storage parameters.
 *
 * Usage:
 *   PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/create-batch.ts
 *
 * Optional env vars:
 *   SOURCE_CHAIN     — Source chain ID (default: 8453 for Base)
 *   BATCH_DEPTH      — Batch depth, determines storage capacity (default: 20)
 *   BATCH_DAYS       — Batch duration in days (default: 30)
 *   NATIVE_AMOUNT    — Extra xDAI to deliver alongside (default: 0)
 *   MOCKED           — Set to "true" to run with mocked steps (no real txs)
 */

import { MultichainSDK, EvmPrivateKeyWallet, type SupportedChainId, type StepStatus } from '../src/index'
import { getStampCost } from '../src/config'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  10: 'Optimism',
  42161: 'Arbitrum',
  8453: 'Base',
}

const STEP_LABELS: Record<string, string> = {
  'relay': 'Bridge tokens via Relay',
  'relay-sync': 'Wait for xDAI arrival on Gnosis',
  'sushi': 'Swap xDAI → xBZZ on SushiSwap',
  'sushi-sync': 'Wait for xBZZ delivery',
  'approve-bzz': 'Approve xBZZ for stamp contract',
  'create-batch': 'Create postage batch',
  'transfer': 'Transfer remaining xDAI to target',
  'transfer-sync': 'Wait for transfer confirmation',
}

const DEPTH_STORAGE: Record<number, string> = {
  17: '44.35 kB',
  18: '6.61 MB',
  19: '111.18 MB',
  20: '682.21 MB',
  21: '2.58 GB',
  22: '7.67 GB',
  23: '19.78 GB',
  24: '46.69 GB',
}

function formatStepStatus(status: StepStatus): string {
  switch (status) {
    case 'pending': return '  '
    case 'in-progress': return '>>'
    case 'completed': return 'OK'
    case 'failed': return '!!'
    case 'skipped': return '--'
  }
}

async function main() {
  // --- Configuration from environment ---
  const privateKey = process.env.PRIVATE_KEY
  const targetAddress = process.env.TARGET_ADDRESS

  if (!privateKey || !targetAddress) {
    console.error('Error: PRIVATE_KEY and TARGET_ADDRESS environment variables are required.')
    console.error('Usage: PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/create-batch.ts')
    process.exit(1)
  }

  const sourceChain = (Number(process.env.SOURCE_CHAIN) || 8453) as SupportedChainId
  const batchDepth = Number(process.env.BATCH_DEPTH) || 20
  const batchDays = Number(process.env.BATCH_DAYS) || 30
  const nativeAmount = Number(process.env.NATIVE_AMOUNT) || 0
  const mocked = process.env.MOCKED === 'true'

  // --- Setup ---
  const sdk = new MultichainSDK({ mocked })
  const wallet = new EvmPrivateKeyWallet({
    privateKey: privateKey as `0x${string}`,
    chainId: sourceChain,
  })

  const sourceAddress = await wallet.getAddress()

  console.log('=== Multichain SDK — Create Postage Batch ===\n')
  console.log(`Source wallet:  ${sourceAddress}`)
  console.log(`Source chain:   ${CHAIN_NAMES[sourceChain] || sourceChain} (${sourceChain})`)
  console.log(`Target address: ${targetAddress}`)
  console.log(`Mode:           ${mocked ? 'MOCKED (no real transactions)' : 'LIVE'}`)
  console.log('')

  // --- Show batch parameters ---
  console.log('Batch Configuration:')
  console.log(`  Depth:    ${batchDepth} (${DEPTH_STORAGE[batchDepth] || 'custom'} storage)`)
  console.log(`  Duration: ${batchDays} days`)
  if (nativeAmount > 0) {
    console.log(`  Extra xDAI: ${nativeAmount}`)
  }

  // --- Show estimated cost ---
  if (!mocked) {
    try {
      const storagePrice = await sdk.getStoragePrice()
      const bzzPrice = await sdk.getBzzPrice()
      const stampCost = getStampCost(batchDepth, batchDays, storagePrice)
      const estimatedUsd = stampCost.bzz.toFloat() * bzzPrice

      console.log('')
      console.log('Estimated Cost:')
      console.log(`  xBZZ needed:  ${stampCost.bzz.toDecimalString()}`)
      console.log(`  BZZ/USD:      $${bzzPrice.toFixed(4)}`)
      console.log(`  Estimated:    ~$${estimatedUsd.toFixed(2)}`)
    } catch {
      console.log('\n  (Could not fetch price estimate)')
    }
  }

  // --- Execute batch creation ---
  console.log('\nStarting cross-chain swap + batch creation...\n')

  const result = await sdk.createBatch(
    {
      wallet,
      sourceChain,
      targetAddress: targetAddress as `0x${string}`,
      batchDepth,
      batchDurationDays: batchDays,
      nativeAmount: nativeAmount > 0 ? nativeAmount : undefined,
    },
    {
      onStatusChange: (status) => {
        if (status === 'in-progress') {
          console.log('[STATUS] Batch creation in progress...')
        } else if (status === 'completed') {
          console.log('[STATUS] Batch creation completed!')
        } else if (status === 'failed') {
          console.log('[STATUS] Batch creation failed!')
        }
      },
      onStepChange: (steps) => {
        console.log('')
        for (const [name, status] of Object.entries(steps)) {
          const label = STEP_LABELS[name] || name
          console.log(`  [${formatStepStatus(status)}] ${label}`)
        }
      },
      onMetadata: (key, value) => {
        console.log(`\n  [META] ${key}: ${value}`)
      },
      onBatchCreated: (data) => {
        console.log(`\n  [BATCH CREATED]`)
        console.log(`    Batch ID: ${data.batchId}`)
        console.log(`    Depth:    ${data.depth}`)
        console.log(`    Amount:   ${data.amount}`)
        console.log(`    Block:    ${data.blockNumber}`)
      },
      onError: (error) => {
        console.error(`\n  [ERROR] ${error.message}`)
      },
    },
  )

  // --- Display results ---
  console.log('\n=== Batch Creation Results ===\n')
  console.log(`Batch ID:    ${result.batchId}`)
  console.log(`Block:       ${result.blockNumber}`)

  console.log('\nSteps:')
  for (const [name, status] of Object.entries(result.steps)) {
    console.log(`  ${name}: ${status}`)
  }

  if (Object.keys(result.metadata).length > 0) {
    console.log('\nExplorer URLs:')
    for (const [key, value] of Object.entries(result.metadata)) {
      console.log(`  ${key}: ${value}`)
    }
  }

  console.log(`\nTemporary wallet:`)
  console.log(`  Address:     ${result.temporaryAddress}`)
  console.log(`  Private key: ${result.temporaryPrivateKey.slice(0, 10)}...${result.temporaryPrivateKey.slice(-4)}`)
}

main().catch((error) => {
  console.error('\nBatch creation failed:', error.message || error)
  process.exit(1)
})
