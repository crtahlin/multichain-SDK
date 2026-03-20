/**
 * Discover Chains & Tokens — Find what's available before swapping
 *
 * This example demonstrates how to:
 *   1. List all supported source chains
 *   2. Check if a specific chain (Base) is supported
 *   3. List available tokens on that chain
 *   4. Find a specific token (USDC) and use it for a quote
 *
 * Usage:
 *   npx tsx examples/discover-chains-tokens.ts
 *
 * No wallet or private key needed.
 */

import { MultichainSDK } from '../src/index'

async function main() {
  const sdk = new MultichainSDK()

  // --- 1. List all supported source chains ---
  console.log('=== Supported Source Chains ===\n')
  const chains = sdk.getSupportedChains()
  for (const chain of chains) {
    console.log(`  ${chain.name} (chain ID: ${chain.id})`)
  }
  console.log(`\nDestination is always Gnosis (chain 100).\n`)

  // --- 2. Check if Base is supported ---
  const targetChainId = 8453
  const isBaseSupported = chains.some(c => c.id === targetChainId)
  console.log(`Is Base (${targetChainId}) supported? ${isBaseSupported ? 'Yes' : 'No'}\n`)

  if (!isBaseSupported) {
    console.log('Base is not supported — exiting.')
    return
  }

  // --- 3. List available tokens on Base ---
  console.log('=== Available Tokens on Base ===\n')
  const tokens = await sdk.getSupportedTokens(targetChainId)
  for (const token of tokens) {
    console.log(`  ${token.symbol.padEnd(8)} ${token.name.padEnd(24)} (${token.decimals} decimals)  ${token.address}`)
  }
  console.log(`\n${tokens.length} tokens available.\n`)

  // --- 4. Find USDC and get a quote paying with it ---
  const usdc = tokens.find(t => t.symbol === 'USDC')

  if (!usdc) {
    console.log('USDC not found on Base.')
    return
  }

  console.log(`=== Quote: 10 xBZZ paid with USDC on Base ===\n`)
  console.log(`Using USDC at ${usdc.address}\n`)

  const quote = await sdk.getQuote({
    sourceChain: targetChainId,
    targetAddress: '0x1234567890123456789012345678901234567890',
    bzzAmount: 10,
    sourceToken: usdc.address as `0x${string}`,
  })

  console.log(`USDC needed:          ${quote.sourceTokenAmount.toDecimalString()} USDC`)
  console.log(`Estimated USD value:  $${quote.estimatedUsdValue.toFixed(2)}`)
  console.log(`BZZ/USD price:        $${quote.bzzUsdPrice.toFixed(4)}`)
}

main().catch((error) => {
  console.error('Error:', error.message || error)
  process.exit(1)
})
