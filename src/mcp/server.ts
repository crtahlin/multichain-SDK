import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Strings } from 'cafe-utility'
import { createPublicClient, formatUnits, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MultichainSDK } from '../MultichainSDK.js'
import { EvmPrivateKeyWallet } from '../wallets/EvmPrivateKeyWallet.js'
import { DEFAULT_RPC_URLS, getStampCost, SUPPORTED_CHAINS } from '../config.js'
import type { SwapQuote, SupportedChainId } from '../types.js'

const QUOTE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface StoredQuote {
  quote: SwapQuote
  expiresAt: number
}

const WALLET_SETUP_INSTRUCTIONS = `\
No funding wallet configured. A funding wallet is needed to pay for cross-chain swaps.

IMPORTANT: The funding wallet is the wallet that holds the tokens you want to spend (e.g. ETH or USDC on Base). \
This is NOT your Bee node's key — your Bee node has its own separate wallet for Gnosis chain operations.

To configure your funding wallet, add PRIVATE_KEY to your MCP server settings. \
SOURCE_CHAIN is optional — if set, it becomes the default source chain; otherwise, you specify the chain in each tool call.

- PRIVATE_KEY: The private key of the wallet holding your funds (e.g. ETH on Base)
- SOURCE_CHAIN (optional): Default blockchain for your funds (e.g. 8453 for Base)

Example for Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):

{
  "mcpServers": {
    "multichain": {
      "command": "node",
      "args": ["/absolute/path/to/multichain-SDK/dist/mcp/cli.js"],
      "env": {
        "PRIVATE_KEY": "0xYourFundingWalletPrivateKey",
        "SOURCE_CHAIN": "8453"
      }
    }
  }
}

Supported SOURCE_CHAIN values: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).

Tip: You can check your funding wallet balance on a block explorer (e.g. basescan.org for Base, etherscan.io for Ethereum).

After updating the config, restart your MCP client (e.g. Claude Desktop) for changes to take effect.`

function getWallet(chainIdOverride?: number): EvmPrivateKeyWallet {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(WALLET_SETUP_INSTRUCTIONS)
  }

  const chainId = chainIdOverride ?? (process.env.SOURCE_CHAIN ? parseInt(process.env.SOURCE_CHAIN, 10) : undefined)
  if (!chainId) {
    throw new Error(
      'No source chain specified. Either set SOURCE_CHAIN in your MCP server config, or provide sourceChain in the tool call.'
    )
  }

  if (!SUPPORTED_CHAINS[chainId as SupportedChainId]) {
    throw new Error(
      `Chain ${chainId} is not supported. Supported chains: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).`
    )
  }

  return new EvmPrivateKeyWallet({
    privateKey: privateKey as `0x${string}`,
    chainId: chainId as SupportedChainId,
  })
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const }
}

function getChainName(chainId: number): string | undefined {
  const chain = SUPPORTED_CHAINS[chainId as SupportedChainId]
  return chain?.name
}

async function getNativeBalance(address: `0x${string}`, chainId: SupportedChainId): Promise<{ balance: string; symbol: string }> {
  const chain = SUPPORTED_CHAINS[chainId]
  const client = createPublicClient({ chain, transport: http(DEFAULT_RPC_URLS[chainId]) })
  const balance = await client.getBalance({ address })
  return {
    balance: formatUnits(balance, chain.nativeCurrency.decimals),
    symbol: chain.nativeCurrency.symbol,
  }
}

export function createMcpServer(): McpServer {
  const sdk = new MultichainSDK()
  const quoteStore = new Map<string, StoredQuote>()

  const server = new McpServer(
    { name: 'multichain-sdk', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions: `This MCP server helps you fund Bee nodes and rent storage on Swarm — a decentralized storage network (like IPFS, but with built-in incentives).

## Two main use cases

1. **Fund a Bee node** — Send xBZZ (Swarm's storage token) and xDAI (for transaction fees) to a Bee node's Gnosis address
2. **Rent storage on Swarm** — Purchase a "postage batch" (storage quota) so you can upload files to Swarm

Both use cases work by bridging tokens from a source chain (Ethereum, Base, Polygon, etc.) to Gnosis chain, where Swarm operates.

## Key concepts

- **Funding wallet** = the wallet with ETH/USDC/etc. that pays for everything (configured via PRIVATE_KEY env var — NOT the Bee node's key). SOURCE_CHAIN is optional — if set, it's the default; otherwise, specify the chain in each tool call
- **Bee node address** = your Bee node's Gnosis chain address that receives xBZZ/xDAI. Find it via the Bee API (\`/addresses\` endpoint) or the swarm_mcp server
- **xBZZ** = Swarm's storage currency on Gnosis chain
- **xDAI** = Gnosis chain's native token, needed for transaction fees

## How to find your Bee node's Gnosis address

- If the swarm_mcp server is available, use its address tools
- Otherwise, query the Bee node's API: \`GET http://<bee-host>:1633/addresses\` → the \`ethereum\` field is the Gnosis address

## Recommended workflow

1. Start with \`multichain_wallet_status\` to check if a funding wallet is configured
2. Use \`multichain_get_supported_chains\` and \`multichain_get_supported_tokens\` to discover payment options
3. For funding: use \`multichain_get_quote\` to preview costs, then \`multichain_execute_swap\` (or \`multichain_swap\` for one step)
4. For storage: use \`multichain_calculate_batch_cost\` to estimate costs, then \`multichain_create_batch\`

## Integration with swarm_mcp

If the user also has the swarm_mcp server configured, you can use it to find the Bee node's address and to upload files after renting storage.

## Note for agent frameworks

In programmatic setups (LangChain, CrewAI, Vercel AI SDK, etc.), environment variables like PRIVATE_KEY and SOURCE_CHAIN are typically set at the process level and shared automatically across all MCP servers. The per-server \`env\` block in Claude Desktop config is only needed for desktop usage — agent frameworks don't require duplicating keys.`,
    },
  )

  // 1. multichain_wallet_status
  server.registerTool(
    'multichain_wallet_status',
    {
      title: 'Check Wallet Configuration',
      description:
        'Check whether a funding wallet is configured and show its address, default chain, and native token balance. ' +
        'Use this first to verify the setup before attempting any transactions. ' +
        'Note: the funding wallet is NOT the Bee node — it\'s the wallet that pays for swaps.',
    },
    async () => {
      const privateKey = process.env.PRIVATE_KEY
      const sourceChainStr = process.env.SOURCE_CHAIN

      if (!privateKey) {
        return jsonResult({
          configured: false,
          message: 'No funding wallet configured.',
          missingVariables: !sourceChainStr
            ? ['PRIVATE_KEY', 'SOURCE_CHAIN']
            : ['PRIVATE_KEY'],
          setupInstructions: WALLET_SETUP_INSTRUCTIONS,
        })
      }

      let address: string
      try {
        const account = privateKeyToAccount(privateKey as `0x${string}`)
        address = account.address
      } catch {
        return errorResult(
          'PRIVATE_KEY is set but invalid. It should be a 64-character hex string starting with 0x (e.g. 0xabc123...).'
        )
      }

      if (!sourceChainStr) {
        return jsonResult({
          configured: true,
          fundingAddress: address,
          sourceChain: null,
          note: 'This is the funding wallet address — NOT the Bee node address. No default SOURCE_CHAIN is set, so you must specify sourceChain in each tool call. Use multichain_wallet_balance to see where your funds are.',
        })
      }

      const chainId = parseInt(sourceChainStr, 10)
      const chainName = getChainName(chainId)

      if (!chainName) {
        return errorResult(
          `SOURCE_CHAIN is set to "${sourceChainStr}" which is not a supported chain. ` +
          'Supported values: 1 (Ethereum), 137 (Polygon), 10 (Optimism), 42161 (Arbitrum), 8453 (Base).'
        )
      }

      const result: Record<string, unknown> = {
        configured: true,
        fundingAddress: address,
        sourceChain: { id: chainId, name: chainName },
        note: 'This is the funding wallet address — NOT the Bee node address. The Bee node has its own separate Gnosis chain address.',
      }

      try {
        const { balance, symbol } = await getNativeBalance(address as `0x${string}`, chainId as SupportedChainId)
        result.nativeBalance = balance
        result.nativeSymbol = symbol
      } catch {
        result.nativeBalance = null
        result.balanceError = 'Could not fetch balance (RPC error). The wallet is still configured correctly.'
      }

      return jsonResult(result)
    },
  )

  // 2. multichain_wallet_balance
  server.registerTool(
    'multichain_wallet_balance',
    {
      title: 'Check Balances Across Chains',
      description:
        'Check the funding wallet\'s native token balance on all supported chains (Ethereum, Polygon, Optimism, Arbitrum, Base). ' +
        'Use this to find where your funds are before choosing a source chain. ' +
        'Requires a configured funding wallet (PRIVATE_KEY). SOURCE_CHAIN is not required — this checks all chains.',
    },
    async () => {
      const privateKey = process.env.PRIVATE_KEY
      if (!privateKey) {
        return errorResult(WALLET_SETUP_INSTRUCTIONS)
      }

      let address: `0x${string}`
      try {
        const account = privateKeyToAccount(privateKey as `0x${string}`)
        address = account.address
      } catch {
        return errorResult(
          'PRIVATE_KEY is set but invalid. It should be a 64-character hex string starting with 0x (e.g. 0xabc123...).'
        )
      }

      const sourceChainStr = process.env.SOURCE_CHAIN
      const configuredChainId = sourceChainStr ? parseInt(sourceChainStr, 10) : null

      const chainIds = Object.keys(SUPPORTED_CHAINS).map(Number) as SupportedChainId[]
      const results = await Promise.allSettled(
        chainIds.map(async (chainId) => {
          const { balance, symbol } = await getNativeBalance(address, chainId)
          return { chainId, chainName: SUPPORTED_CHAINS[chainId].name, balance, symbol }
        })
      )

      const balances = results.map((result, i) => {
        const chainId = chainIds[i]
        if (result.status === 'fulfilled') {
          return {
            ...result.value,
            isConfiguredChain: chainId === configuredChainId,
          }
        }
        return {
          chainId,
          chainName: SUPPORTED_CHAINS[chainId].name,
          balance: null,
          symbol: SUPPORTED_CHAINS[chainId].nativeCurrency.symbol,
          error: 'RPC error — could not fetch balance for this chain',
          isConfiguredChain: chainId === configuredChainId,
        }
      })

      return jsonResult({ fundingAddress: address, balances })
    },
  )

  // 3. multichain_get_supported_chains
  server.registerTool(
    'multichain_get_supported_chains',
    {
      title: 'List Funding Chains',
      description:
        'List all blockchains you can pay from (Ethereum, Base, Polygon, etc.). ' +
        'Your funding wallet must hold tokens on one of these chains. Destination is always Gnosis chain.',
    },
    async () => {
      const chains = sdk.getSupportedChains()
      return jsonResult({ chains })
    },
  )

  // 3. multichain_get_supported_tokens
  server.registerTool(
    'multichain_get_supported_tokens',
    {
      title: 'List Accepted Tokens',
      description:
        'List tokens you can use to pay on a given source chain (e.g. ETH, USDC, USDT on Base). ' +
        'Use multichain_get_supported_chains first to find the chain ID.',
      inputSchema: { chainId: z.number().describe('Source chain ID (e.g. 8453 for Base). Use multichain_get_supported_chains to find options.') },
    },
    async ({ chainId }) => {
      try {
        const tokens = await sdk.getSupportedTokens(chainId)
        return jsonResult({ tokens })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 4. multichain_get_bzz_price
  server.registerTool(
    'multichain_get_bzz_price',
    {
      title: 'Get BZZ Token Price',
      description: 'Get the current BZZ/USD price. BZZ is Swarm\'s storage currency — you need it to rent storage or run a Bee node.',
    },
    async () => {
      try {
        const price = await sdk.getBzzPrice()
        return jsonResult({ bzzUsdPrice: price })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 5. multichain_calculate_batch_cost
  server.registerTool(
    'multichain_calculate_batch_cost',
    {
      title: 'Estimate Storage Cost',
      description:
        'Estimate how much it costs to rent storage on Swarm. ' +
        'Storage is purchased as a "postage batch" with a capacity level (depth) and duration in days. ' +
        'Capacity levels: 17 (~44 kB), 18 (~6.6 MB), 19 (~111 MB), 20 (~682 MB, recommended), ' +
        '21 (~2.6 GB), 22 (~7.7 GB), 23 (~19.8 GB), 24 (~46.7 GB). ' +
        'Cost scales linearly with duration and exponentially with capacity.',
      inputSchema: {
        depth: z.number().int().min(17).max(24).describe('Storage capacity level (17-24). 20 (~682 MB) is recommended for most use cases.'),
        days: z.number().positive().describe('How many days the storage should last.'),
      },
    },
    async ({ depth, days }) => {
      try {
        const storagePrice = await sdk.getStoragePrice()
        const bzzPrice = await sdk.getBzzPrice()
        const stampCost = getStampCost(depth, days, storagePrice)
        const bzzAmount = stampCost.bzz.toFloat()
        const usdCost = bzzAmount * bzzPrice
        return jsonResult({
          bzzAmount,
          bzzUsdPrice: bzzPrice,
          estimatedUsdCost: usdCost,
          depth,
          days,
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 6. multichain_get_quote
  server.registerTool(
    'multichain_get_quote',
    {
      title: 'Preview Funding Cost',
      description:
        'Preview how much it will cost to fund a Bee node, without executing anything. ' +
        'Returns a quoteId and estimated cost. Pass the quoteId to multichain_execute_swap to execute. ' +
        'No wallet needed — use this to check costs before committing. ' +
        'Quote expires after 5 minutes. At least one of bzzAmount or nativeAmount must be > 0.',
      inputSchema: {
        sourceChain: z.number().describe('Chain ID where your funds are (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base).'),
        targetAddress: z.string().describe('Bee node\'s Gnosis address (0x...). Find via Bee API (/addresses endpoint) or swarm_mcp.'),
        bzzAmount: z.number().optional().describe('Amount of xBZZ (Swarm storage token) to deliver. In whole BZZ units. Defaults to 0.'),
        nativeAmount: z.number().optional().describe('Amount of xDAI (for transaction fees) to deliver. In whole DAI units. Defaults to 0.'),
        sourceToken: z.string().optional().describe('Token address to pay with. Defaults to native token (ETH). Use multichain_get_supported_tokens to find options like USDC.'),
      },
    },
    async ({ sourceChain, targetAddress, bzzAmount, nativeAmount, sourceToken }) => {
      try {
        const quote = await sdk.getQuote({
          sourceChain: sourceChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}`,
          bzzAmount,
          nativeAmount,
          sourceToken: sourceToken as `0x${string}` | undefined,
        })

        const quoteId = Strings.randomHex(16)
        quoteStore.set(quoteId, { quote, expiresAt: Date.now() + QUOTE_TTL_MS })

        return jsonResult({
          quoteId,
          sourceTokenAmount: quote.sourceTokenAmount.toDecimalString(),
          estimatedUsdValue: quote.estimatedUsdValue,
          bzzUsdPrice: quote.bzzUsdPrice,
          expiresInSeconds: 300,
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 7. multichain_execute_swap
  server.registerTool(
    'multichain_execute_swap',
    {
      title: 'Execute Swap from Quote',
      description:
        'Execute a previously previewed swap. The quoteId comes from multichain_get_quote. ' +
        'Each quote can only be used once and expires after 5 minutes. ' +
        'The source chain is determined by the quote — no need to specify it again. ' +
        'Requires a configured funding wallet (PRIVATE_KEY) — use multichain_wallet_status to check.',
      inputSchema: {
        quoteId: z.string().describe('Quote ID from multichain_get_quote'),
      },
    },
    async ({ quoteId }) => {
      const stored = quoteStore.get(quoteId)
      if (!stored) {
        return errorResult(`Quote "${quoteId}" not found. It may have been used already or never existed.`)
      }

      if (Date.now() > stored.expiresAt) {
        quoteStore.delete(quoteId)
        return errorResult('Quote has expired. Please request a new quote with multichain_get_quote.')
      }

      let wallet
      try {
        wallet = getWallet(stored.quote.request.sourceChain)
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }

      // Consume quote (single use)
      quoteStore.delete(quoteId)

      try {
        const result = await sdk.executeSwap(stored.quote, wallet)
        return jsonResult({
          status: 'completed',
          steps: result.steps,
          metadata: result.metadata,
          temporaryPrivateKey: result.temporaryPrivateKey,
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 8. multichain_swap
  server.registerTool(
    'multichain_swap',
    {
      title: 'Fund Bee Node (One Step)',
      description:
        'Fund a Bee node with xBZZ (Swarm storage token) and/or xDAI (transaction fees) in one step. ' +
        'Bridges tokens from your funding wallet to Gnosis chain and delivers them to the Bee node. ' +
        'Simpler than get_quote + execute_swap but no cost preview. ' +
        'At least one of bzzAmount or nativeAmount must be > 0. ' +
        'Requires a configured funding wallet — use multichain_wallet_status to check.',
      inputSchema: {
        sourceChain: z.number().describe('Chain ID where your funds are (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base).'),
        targetAddress: z.string().describe('Bee node\'s Gnosis address (0x...). Find via Bee API (/addresses endpoint) or swarm_mcp.'),
        bzzAmount: z.number().optional().describe('Amount of xBZZ (Swarm storage token) to deliver. In whole BZZ units. Defaults to 0.'),
        nativeAmount: z.number().optional().describe('Amount of xDAI (for transaction fees) to deliver. In whole DAI units. Defaults to 0.'),
        sourceToken: z.string().optional().describe('Token address to pay with. Defaults to native token (ETH). Use multichain_get_supported_tokens to find options like USDC.'),
      },
    },
    async ({ sourceChain, targetAddress, bzzAmount, nativeAmount, sourceToken }) => {
      let wallet
      try {
        wallet = getWallet(sourceChain)
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }

      try {
        const result = await sdk.swap({
          wallet,
          sourceChain: sourceChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}`,
          bzzAmount,
          nativeAmount,
          sourceToken: sourceToken as `0x${string}` | undefined,
        })
        return jsonResult({
          status: 'completed',
          steps: result.steps,
          metadata: result.metadata,
          temporaryPrivateKey: result.temporaryPrivateKey,
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 9. multichain_create_batch
  server.registerTool(
    'multichain_create_batch',
    {
      title: 'Rent Swarm Storage',
      description:
        'Rent storage on Swarm by purchasing a postage batch. This is a one-step operation: ' +
        'bridges tokens from your funding wallet, converts to xBZZ, and creates the storage batch. ' +
        'Use multichain_calculate_batch_cost first to estimate the cost. ' +
        'Capacity levels: 17 (~44 kB), 18 (~6.6 MB), 19 (~111 MB), 20 (~682 MB, recommended), ' +
        '21 (~2.6 GB), 22 (~7.7 GB), 23 (~19.8 GB), 24 (~46.7 GB). ' +
        'Requires a configured funding wallet — use multichain_wallet_status to check.',
      inputSchema: {
        sourceChain: z.number().describe('Chain ID where your funds are (1=Ethereum, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base).'),
        targetAddress: z.string().describe('Bee node\'s Gnosis address (0x...) to receive remaining xDAI. Find via Bee API or swarm_mcp.'),
        batchDepth: z.number().int().min(17).max(24).describe('Storage capacity level (17-24). 20 (~682 MB) is recommended for most use cases.'),
        batchDurationDays: z.number().positive().describe('How many days the storage should last.'),
        nativeAmount: z.number().optional().describe('Extra xDAI (for transaction fees) to deliver alongside the batch. Defaults to 0.'),
      },
    },
    async ({ sourceChain, targetAddress, batchDepth, batchDurationDays, nativeAmount }) => {
      let wallet
      try {
        wallet = getWallet(sourceChain)
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }

      try {
        const result = await sdk.createBatch({
          wallet,
          sourceChain: sourceChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}`,
          batchDepth,
          batchDurationDays,
          nativeAmount,
        })
        return jsonResult({
          status: 'completed',
          batchId: result.batchId,
          blockNumber: result.blockNumber,
          steps: result.steps,
          metadata: result.metadata,
          temporaryPrivateKey: result.temporaryPrivateKey,
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  return server
}
