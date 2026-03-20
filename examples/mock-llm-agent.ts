/**
 * Mock LLM Agent — Simulated AI agent using the SDK via tool calling
 *
 * This example demonstrates how an AI agent would integrate with the
 * Multichain SDK using a tool-calling pattern. It simulates an LLM
 * that receives a user request, reasons about which tools to call,
 * and executes SDK operations.
 *
 * This pattern works with any LLM framework:
 *   - Anthropic Claude (native tool use)
 *   - OpenAI function calling
 *   - LangChain / LangGraph
 *   - Vercel AI SDK
 *
 * The example runs in mocked mode (no real transactions) to show
 * the full agent loop without requiring blockchain access.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx examples/mock-llm-agent.ts
 *
 * The PRIVATE_KEY is only used for address derivation in mocked mode.
 */

import {
  MultichainSDK,
  EvmPrivateKeyWallet,
  type SupportedChainId,
  type SwapQuote,
  type SwapResult,
  type BatchResult,
} from '../src/index'
import { getStampCost } from '../src/config'

// ============================================================
// Tool Definitions — These would be registered with your LLM
// ============================================================

/**
 * Tool definitions in a format similar to what you'd pass to an LLM.
 * Each tool has a name, description, and parameter schema.
 */
const TOOL_DEFINITIONS = [
  {
    name: 'get_bzz_price',
    description: 'Get the current BZZ/USD price. Use this to estimate costs before swapping.',
    parameters: {},
  },
  {
    name: 'get_quote',
    description: 'Get a cross-chain swap quote showing how much source tokens are needed. Does not execute any transaction.',
    parameters: {
      source_chain: 'Chain ID to swap from (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base)',
      target_address: 'Gnosis address to receive the funds',
      bzz_amount: 'Amount of xBZZ to deliver (optional, default 0)',
      native_amount: 'Amount of xDAI to deliver (optional, default 0)',
    },
  },
  {
    name: 'execute_swap',
    description: 'Execute a cross-chain swap to deliver xBZZ and/or xDAI to a target address on Gnosis.',
    parameters: {
      source_chain: 'Chain ID to swap from',
      target_address: 'Gnosis address to receive the funds',
      bzz_amount: 'Amount of xBZZ to deliver (optional)',
      native_amount: 'Amount of xDAI to deliver (optional)',
    },
  },
  {
    name: 'create_batch',
    description: 'Create a Swarm postage batch. This performs a cross-chain swap and creates a batch in one operation.',
    parameters: {
      source_chain: 'Chain ID to swap from',
      target_address: 'Gnosis address (batch owner)',
      batch_depth: 'Storage depth (17-24, higher = more storage)',
      batch_duration_days: 'How long the batch should last in days',
    },
  },
  {
    name: 'calculate_batch_cost',
    description: 'Calculate the estimated cost of a postage batch without executing anything.',
    parameters: {
      batch_depth: 'Storage depth (17-24)',
      batch_duration_days: 'Duration in days',
    },
  },
]

// ============================================================
// Tool Implementations — SDK calls wrapped for agent use
// ============================================================

class AgentToolkit {
  private sdk: MultichainSDK
  private wallet: EvmPrivateKeyWallet

  constructor(sdk: MultichainSDK, wallet: EvmPrivateKeyWallet) {
    this.sdk = sdk
    this.wallet = wallet
  }

  async get_bzz_price(): Promise<string> {
    const price = await this.sdk.getBzzPrice()
    return JSON.stringify({ bzz_usd_price: price, formatted: `$${price.toFixed(4)}` })
  }

  async get_quote(params: {
    source_chain: number
    target_address: string
    bzz_amount?: number
    native_amount?: number
  }): Promise<string> {
    const quote = await this.sdk.getQuote({
      wallet: this.wallet,
      sourceChain: params.source_chain as SupportedChainId,
      targetAddress: params.target_address as `0x${string}`,
      bzzAmount: params.bzz_amount,
      nativeAmount: params.native_amount,
    })
    return JSON.stringify({
      source_tokens_needed: quote.sourceTokenAmount.toDecimalString(),
      estimated_usd: quote.estimatedUsdValue.toFixed(2),
      bzz_usd_price: quote.bzzUsdPrice.toFixed(4),
      temporary_address: quote.temporaryAddress,
    })
  }

  async execute_swap(params: {
    source_chain: number
    target_address: string
    bzz_amount?: number
    native_amount?: number
  }): Promise<string> {
    const result = await this.sdk.swap({
      wallet: this.wallet,
      sourceChain: params.source_chain as SupportedChainId,
      targetAddress: params.target_address as `0x${string}`,
      bzzAmount: params.bzz_amount,
      nativeAmount: params.native_amount,
    })
    return JSON.stringify({
      status: 'completed',
      steps: result.steps,
      temporary_address: result.temporaryAddress,
    })
  }

  async create_batch(params: {
    source_chain: number
    target_address: string
    batch_depth: number
    batch_duration_days: number
  }): Promise<string> {
    const result = await this.sdk.createBatch({
      wallet: this.wallet,
      sourceChain: params.source_chain as SupportedChainId,
      targetAddress: params.target_address as `0x${string}`,
      batchDepth: params.batch_depth,
      batchDurationDays: params.batch_duration_days,
    })
    return JSON.stringify({
      status: 'completed',
      batch_id: result.batchId,
      block_number: result.blockNumber,
      steps: result.steps,
    })
  }

  async calculate_batch_cost(params: {
    batch_depth: number
    batch_duration_days: number
  }): Promise<string> {
    const storagePrice = await this.sdk.getStoragePrice()
    const bzzPrice = await this.sdk.getBzzPrice()
    const cost = getStampCost(params.batch_depth, params.batch_duration_days, storagePrice)
    const usdCost = cost.bzz.toFloat() * bzzPrice

    return JSON.stringify({
      bzz_needed: cost.bzz.toDecimalString(),
      bzz_usd_price: bzzPrice.toFixed(4),
      estimated_usd: usdCost.toFixed(2),
      batch_amount: cost.amount.toString(),
    })
  }
}

// ============================================================
// Simulated Agent Loop — Mimics LLM reasoning + tool calls
// ============================================================

/**
 * Simulated conversation between a user and an AI agent.
 * Each turn has a user message and the agent's planned tool calls.
 *
 * In a real implementation, these tool calls would come from the LLM,
 * not be hardcoded. This example shows what the flow looks like.
 */
const SIMULATED_CONVERSATION = [
  {
    user: "What's the current price of BZZ?",
    agent_reasoning: "The user wants to know the BZZ price. I'll use the get_bzz_price tool.",
    tool_call: { name: 'get_bzz_price', params: {} },
    agent_response: (result: string) => {
      const data = JSON.parse(result)
      return `The current BZZ price is ${data.formatted} per token.`
    },
  },
  {
    user: "How much would it cost to create a postage batch with depth 20 for 30 days?",
    agent_reasoning: "The user wants a cost estimate. I'll use calculate_batch_cost to get the numbers.",
    tool_call: {
      name: 'calculate_batch_cost',
      params: { batch_depth: 20, batch_duration_days: 30 },
    },
    agent_response: (result: string) => {
      const data = JSON.parse(result)
      return `A depth-20 batch for 30 days would cost approximately ${data.bzz_needed} BZZ (~$${data.estimated_usd} at current prices).`
    },
  },
  {
    user: "OK, let me get a quote for funding my Bee node at 0xBEE0000000000000000000000000000000000001 with 10 BZZ and 0.5 xDAI from Base.",
    agent_reasoning: "The user wants a quote. I'll use get_quote to preview the cost without executing.",
    tool_call: {
      name: 'get_quote',
      params: {
        source_chain: 8453,
        target_address: '0xBEE0000000000000000000000000000000000001',
        bzz_amount: 10,
        native_amount: 0.5,
      },
    },
    agent_response: (result: string) => {
      const data = JSON.parse(result)
      return `To fund your Bee node, you'll need approximately ${data.source_tokens_needed} tokens on Base (~$${data.estimated_usd}). The funds will route through temporary address ${data.temporary_address}. Shall I proceed?`
    },
  },
  {
    user: "Yes, go ahead and create a batch with depth 20 for 30 days for that address.",
    agent_reasoning: "The user confirmed and wants a batch. I'll use create_batch which handles the entire flow.",
    tool_call: {
      name: 'create_batch',
      params: {
        source_chain: 8453,
        target_address: '0xBEE0000000000000000000000000000000000001',
        batch_depth: 20,
        batch_duration_days: 30,
      },
    },
    agent_response: (result: string) => {
      const data = JSON.parse(result)
      return `Postage batch created successfully!\n  Batch ID: ${data.batch_id}\n  All ${Object.keys(data.steps).length} steps completed.`
    },
  },
]

async function main() {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required.')
    console.error('Usage: PRIVATE_KEY=0x... npx tsx examples/mock-llm-agent.ts')
    process.exit(1)
  }

  // --- Setup (always mocked for this demo) ---
  const sdk = new MultichainSDK({ mocked: true })
  const wallet = new EvmPrivateKeyWallet({
    privateKey: privateKey as `0x${string}`,
    chainId: 8453,
  })
  const toolkit = new AgentToolkit(sdk, wallet)
  const sourceAddress = await wallet.getAddress()

  console.log('=== Multichain SDK — Mock LLM Agent Demo ===')
  console.log(`Agent wallet: ${sourceAddress}`)
  console.log('Mode: MOCKED (simulated transactions)')
  console.log('')
  console.log('This demo simulates an AI agent using tool calling to')
  console.log('interact with the Multichain SDK. In a real implementation,')
  console.log('the tool calls would come from an LLM (Claude, GPT, etc.).')
  console.log('')
  console.log('Available tools:')
  for (const tool of TOOL_DEFINITIONS) {
    console.log(`  - ${tool.name}: ${tool.description.slice(0, 60)}...`)
  }
  console.log('\n' + '='.repeat(60) + '\n')

  // --- Run simulated conversation ---
  for (const turn of SIMULATED_CONVERSATION) {
    // User message
    console.log(`USER: ${turn.user}\n`)

    // Agent reasoning (this would be internal LLM thinking)
    console.log(`AGENT (thinking): ${turn.agent_reasoning}\n`)

    // Tool call
    console.log(`AGENT -> tool_call: ${turn.tool_call.name}(${JSON.stringify(turn.tool_call.params)})`)

    // Execute tool
    const toolFn = toolkit[turn.tool_call.name as keyof AgentToolkit] as (params: any) => Promise<string>
    const result = await toolFn.call(toolkit, turn.tool_call.params)
    console.log(`TOOL  -> result: ${result}\n`)

    // Agent response
    const response = turn.agent_response(result)
    console.log(`AGENT: ${response}`)
    console.log('\n' + '-'.repeat(60) + '\n')
  }

  console.log('=== Demo Complete ===')
  console.log('')
  console.log('To integrate with a real LLM, register the tools from')
  console.log('TOOL_DEFINITIONS with your framework of choice and')
  console.log('implement the AgentToolkit pattern shown above.')
}

main().catch((error) => {
  console.error('Agent demo failed:', error.message || error)
  process.exit(1)
})
