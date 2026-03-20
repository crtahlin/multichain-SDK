/**
 * Quote Preview — Get a cross-chain swap quote without executing
 *
 * This example demonstrates how to use the SDK to preview swap costs
 * before committing any funds. No private key or wallet is required —
 * just specify what you want and see the price.
 *
 * Usage:
 *   npx tsx examples/quote-preview.ts
 *
 * Optional env vars:
 *   SOURCE_CHAIN   — Source chain ID (default: 8453 for Base)
 *   TARGET_ADDRESS — Gnosis address to receive funds (default: demo address)
 *   BZZ_AMOUNT     — Amount of xBZZ to deliver (default: 10)
 *   NATIVE_AMOUNT  — Amount of xDAI to deliver (default: 0.5)
 */

import { MultichainSDK, type SupportedChainId } from '../src/index'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  10: 'Optimism',
  42161: 'Arbitrum',
  8453: 'Base',
}

async function main() {
  // --- Configuration from environment ---
  const sourceChain = (Number(process.env.SOURCE_CHAIN) || 8453) as SupportedChainId
  const targetAddress = (process.env.TARGET_ADDRESS || '0x1234567890123456789012345678901234567890') as `0x${string}`
  const bzzAmount = Number(process.env.BZZ_AMOUNT) || 10
  const nativeAmount = Number(process.env.NATIVE_AMOUNT) || 0.5

  // --- Setup ---
  const sdk = new MultichainSDK()

  console.log('=== Multichain SDK — Quote Preview ===\n')
  console.log(`Source chain:   ${CHAIN_NAMES[sourceChain] || sourceChain} (${sourceChain})`)
  console.log(`Target address: ${targetAddress}`)
  console.log(`BZZ amount:     ${bzzAmount} xBZZ`)
  console.log(`Native amount:  ${nativeAmount} xDAI`)
  console.log('')

  // --- Fetch quote (no wallet needed!) ---
  console.log('Fetching quote from Relay Protocol...\n')

  const quote = await sdk.getQuote({
    sourceChain,
    targetAddress,
    bzzAmount,
    nativeAmount,
  })

  // --- Display results ---
  console.log('=== Quote Results ===\n')
  console.log(`Source tokens needed:  ${quote.sourceTokenAmount.toDecimalString()}`)
  console.log(`Estimated USD value:   $${quote.estimatedUsdValue.toFixed(2)}`)
  console.log(`BZZ/USD price:         $${quote.bzzUsdPrice.toFixed(4)}`)
  console.log(`BZZ portion (USD):     $${quote.bzzUsdValue.toFixed(2)}`)
  console.log(`Native portion (xDAI): ${quote.nativeAmount}`)
  console.log(`Total xDAI bridged:    ${quote.totalDaiValue.toDecimalString()}`)
  console.log(`Temporary address:     ${quote.temporaryAddress}`)
  console.log('')
  console.log('Quote fetched successfully. No funds were spent.')
  console.log('To execute this swap, call sdk.executeSwap(quote, wallet)')
}

main().catch((error) => {
  console.error('Failed to fetch quote:', error.message || error)
  process.exit(1)
})
