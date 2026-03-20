/**
 * Fund Bee Node — Cross-chain swap to deliver xBZZ + xDAI to a Bee node wallet
 *
 * This example demonstrates the full funding flow: bridging tokens from a
 * source EVM chain to Gnosis, swapping to xBZZ via SushiSwap, and
 * transferring remaining xDAI to the target address.
 *
 * The flow has 6 steps:
 *   1. Relay bridge (source chain → Gnosis xDAI)
 *   2. Wait for xDAI arrival
 *   3. SushiSwap xDAI → xBZZ (delivered to target)
 *   4. Wait for xBZZ arrival
 *   5. Transfer remaining xDAI to target
 *   6. Wait for transfer confirmation
 *
 * Usage:
 *   PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/fund-bee-node.ts
 *
 * Optional env vars:
 *   SOURCE_CHAIN  — Source chain ID (default: 8453 for Base)
 *   BZZ_AMOUNT    — xBZZ to deliver (default: 10)
 *   NATIVE_AMOUNT — xDAI to deliver (default: 0.5)
 *   MOCKED        — Set to "true" to run with mocked steps (no real txs)
 */

import { MultichainSDK, EvmPrivateKeyWallet, type SupportedChainId, type StepStatus } from '../src/index'

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
  'transfer': 'Transfer remaining xDAI to target',
  'transfer-sync': 'Wait for transfer confirmation',
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
    console.error('Usage: PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/fund-bee-node.ts')
    process.exit(1)
  }

  const sourceChain = (Number(process.env.SOURCE_CHAIN) || 8453) as SupportedChainId
  const bzzAmount = Number(process.env.BZZ_AMOUNT) || 10
  const nativeAmount = Number(process.env.NATIVE_AMOUNT) || 0.5
  const mocked = process.env.MOCKED === 'true'

  // --- Setup ---
  const sdk = new MultichainSDK({ mocked })
  const wallet = new EvmPrivateKeyWallet({
    privateKey: privateKey as `0x${string}`,
    chainId: sourceChain,
  })

  const sourceAddress = await wallet.getAddress()

  console.log('=== Multichain SDK — Fund Bee Node ===\n')
  console.log(`Source wallet:  ${sourceAddress}`)
  console.log(`Source chain:   ${CHAIN_NAMES[sourceChain] || sourceChain} (${sourceChain})`)
  console.log(`Target address: ${targetAddress}`)
  console.log(`BZZ amount:     ${bzzAmount} xBZZ`)
  console.log(`Native amount:  ${nativeAmount} xDAI`)
  console.log(`Mode:           ${mocked ? 'MOCKED (no real transactions)' : 'LIVE'}`)
  console.log('')

  // --- Execute swap ---
  console.log('Starting cross-chain swap...\n')

  const result = await sdk.swap(
    {
      wallet,
      sourceChain,
      targetAddress: targetAddress as `0x${string}`,
      bzzAmount,
      nativeAmount,
    },
    {
      onStatusChange: (status) => {
        if (status === 'in-progress') {
          console.log('[STATUS] Swap in progress...')
        } else if (status === 'completed') {
          console.log('[STATUS] Swap completed successfully!')
        } else if (status === 'failed') {
          console.log('[STATUS] Swap failed!')
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
      onError: (error) => {
        console.error(`\n  [ERROR] ${error.message}`)
      },
    },
  )

  // --- Display results ---
  console.log('\n=== Swap Results ===\n')
  console.log('Steps:')
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
  console.log('  (Save this key to recover funds if something went wrong)')
}

main().catch((error) => {
  console.error('\nSwap failed:', error.message || error)
  process.exit(1)
})
