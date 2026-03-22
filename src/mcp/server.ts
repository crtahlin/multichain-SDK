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

interface RecoveryEntry {
  temporaryAddress: `0x${string}`
  temporaryPrivateKey: `0x${string}`
  createdAt: string
  operation: 'swap' | 'batch'
  sourceChain: number
  targetAddress?: string
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

function getWallet(chainIdOverride?: number | string): EvmPrivateKeyWallet {
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(WALLET_SETUP_INSTRUCTIONS)
  }

  const resolved = chainIdOverride != null ? resolveChainId(chainIdOverride) : undefined
  const chainId = resolved ?? (process.env.SOURCE_CHAIN ? parseInt(process.env.SOURCE_CHAIN, 10) : undefined)
  if (!chainId) {
    throw new Error(
      'No source chain specified. Either set SOURCE_CHAIN in your MCP server config, or provide sourceChain in the tool call.'
    )
  }

  if (chainIdOverride != null && resolved == null) {
    throw new Error(
      `Unknown chain "${chainIdOverride}". Use a chain ID (1, 137, 10, 42161, 8453) or name (ethereum, polygon, optimism, arbitrum, base).`
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

/** Map of lowercase chain names/aliases to chain IDs */
const CHAIN_NAME_MAP: Record<string, SupportedChainId> = {
  ethereum: 1, eth: 1, mainnet: 1,
  polygon: 137, matic: 137, poly: 137,
  optimism: 10, op: 10,
  arbitrum: 42161, arb: 42161,
  base: 8453,
}

/**
 * Resolve a chain identifier (number or name) to a numeric chain ID.
 * Accepts: numeric IDs (8453), numeric strings ("8453"), or names ("base", "ethereum").
 * Returns undefined if the input cannot be resolved.
 */
function resolveChainId(input: number | string): number | undefined {
  if (typeof input === 'number') return input
  const trimmed = input.trim()
  const asNumber = Number(trimmed)
  if (!isNaN(asNumber) && trimmed.length > 0) return asNumber
  return CHAIN_NAME_MAP[trimmed.toLowerCase()]
}

/** Zod schema for chain parameters that accept both IDs and names */
const chainIdSchema = z.union([z.number(), z.string()]).describe(
  'Chain ID (e.g. 8453) or name (e.g. "base", "ethereum", "polygon", "optimism", "arbitrum").'
)

/** Retry an async function once after a 1-second delay on failure */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return fn()
  }
}

async function getNativeBalance(address: `0x${string}`, chainId: SupportedChainId): Promise<{ balance: string; symbol: string }> {
  const chain = SUPPORTED_CHAINS[chainId]
  const client = createPublicClient({ chain, transport: http(DEFAULT_RPC_URLS[chainId]) })
  const balance = await withRetry(() => client.getBalance({ address }))
  return {
    balance: formatUnits(balance, chain.nativeCurrency.decimals),
    symbol: chain.nativeCurrency.symbol,
  }
}

const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

async function getTokenBalance(
  address: `0x${string}`,
  tokenAddress: `0x${string}`,
  decimals: number,
  chainId: SupportedChainId,
): Promise<string> {
  const chain = SUPPORTED_CHAINS[chainId]
  const client = createPublicClient({ chain, transport: http(DEFAULT_RPC_URLS[chainId]) })
  const balance = await withRetry(() => client.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: [address],
  }))
  return formatUnits(balance, decimals)
}

/** Well-known ERC-20 tokens to check by default on each chain */
const COMMON_TOKENS: Record<SupportedChainId, Array<{ address: `0x${string}`; symbol: string; decimals: number }>> = {
  1: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  ],
  137: [
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', decimals: 6 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
  ],
  10: [
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
  ],
  42161: [
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
  ],
  8453: [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  ],
}

export function createMcpServer(): McpServer {
  const sdk = new MultichainSDK()
  const quoteStore = new Map<string, StoredQuote>()
  const recoveryStore = new Map<string, RecoveryEntry>()

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
        'Check the funding wallet\'s balances on all supported chains (Ethereum, Polygon, Optimism, Arbitrum, Base). ' +
        'Shows native token (ETH/POL) plus common ERC-20 tokens (USDC, USDT) by default. ' +
        'Optionally specify a token address or symbol to check a specific token. ' +
        'Use this to find where your funds are before choosing a source chain. ' +
        'Requires a configured funding wallet (PRIVATE_KEY). SOURCE_CHAIN is not required — this checks all chains.',
      inputSchema: {
        token: z.string().optional().describe(
          'Optional: specific token to check. Pass a token address (0x...) or symbol (e.g. "USDC"). ' +
          'If a symbol is given, it is looked up from the swap-supported token list for each chain. ' +
          'Without this parameter, shows native token + common tokens (USDC, USDT).'
        ),
      },
    },
    async ({ token }) => {
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

      // If a specific token was requested, resolve it per chain
      let specificToken: { perChain: Map<SupportedChainId, { address: `0x${string}`; symbol: string; decimals: number }> } | null = null
      if (token) {
        const isAddress = token.startsWith('0x') && token.length === 42
        const perChain = new Map<SupportedChainId, { address: `0x${string}`; symbol: string; decimals: number }>()

        if (isAddress) {
          // Look up token info from Relay's token list for each chain
          const lookups = await Promise.allSettled(
            chainIds.map(async (chainId) => {
              const tokens = await sdk.getSupportedTokens(chainId)
              const found = tokens.find(t => t.address.toLowerCase() === token.toLowerCase())
              if (found) {
                perChain.set(chainId, { address: found.address as `0x${string}`, symbol: found.symbol, decimals: found.decimals })
              }
            })
          )
        } else {
          // Symbol lookup — find on each chain
          const symbolUpper = token.toUpperCase()
          const lookups = await Promise.allSettled(
            chainIds.map(async (chainId) => {
              const tokens = await sdk.getSupportedTokens(chainId)
              const found = tokens.find(t => t.symbol.toUpperCase() === symbolUpper)
              if (found) {
                perChain.set(chainId, { address: found.address as `0x${string}`, symbol: found.symbol, decimals: found.decimals })
              }
            })
          )
        }

        if (perChain.size === 0) {
          return errorResult(
            `Token "${token}" not found on any supported chain. Use multichain_get_supported_tokens to see available tokens.`
          )
        }
        specificToken = { perChain }
      }

      const results = await Promise.allSettled(
        chainIds.map(async (chainId) => {
          const chain = SUPPORTED_CHAINS[chainId]
          const entry: Record<string, unknown> = {
            chainId,
            chainName: chain.name,
            isConfiguredChain: chainId === configuredChainId,
          }

          // Native balance
          try {
            const { balance, symbol } = await getNativeBalance(address, chainId)
            entry.nativeBalance = balance
            entry.nativeSymbol = symbol
          } catch {
            entry.nativeBalance = null
            entry.nativeSymbol = chain.nativeCurrency.symbol
            entry.nativeError = 'RPC error'
          }

          // Token balances
          const tokenBalances: Array<{ symbol: string; address: string; balance: string | null; error?: string }> = []

          if (specificToken) {
            // Check one specific token
            const tokenInfo = specificToken.perChain.get(chainId)
            if (tokenInfo) {
              try {
                const bal = await getTokenBalance(address, tokenInfo.address, tokenInfo.decimals, chainId)
                tokenBalances.push({ symbol: tokenInfo.symbol, address: tokenInfo.address, balance: bal })
              } catch {
                tokenBalances.push({ symbol: tokenInfo.symbol, address: tokenInfo.address, balance: null, error: 'RPC error' })
              }
            }
          } else {
            // Check common tokens for this chain
            const commonTokens = COMMON_TOKENS[chainId] ?? []
            const tokenResults = await Promise.allSettled(
              commonTokens.map(async (t) => {
                const bal = await getTokenBalance(address, t.address, t.decimals, chainId)
                return { symbol: t.symbol, address: t.address, balance: bal }
              })
            )
            for (const [idx, result] of tokenResults.entries()) {
              if (result.status === 'fulfilled') {
                tokenBalances.push(result.value)
              } else {
                const t = commonTokens[idx]
                tokenBalances.push({ symbol: t.symbol, address: t.address, balance: null, error: 'RPC error' })
              }
            }
          }

          if (tokenBalances.length > 0) {
            entry.tokens = tokenBalances
          }

          return entry
        })
      )

      const balances = results.map((result, i) => {
        if (result.status === 'fulfilled') {
          return result.value
        }
        const chainId = chainIds[i]
        return {
          chainId,
          chainName: SUPPORTED_CHAINS[chainId].name,
          nativeBalance: null,
          nativeSymbol: SUPPORTED_CHAINS[chainId].nativeCurrency.symbol,
          error: 'RPC error — could not fetch balances for this chain',
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
      inputSchema: { chainId: chainIdSchema },
    },
    async ({ chainId }) => {
      const resolved = resolveChainId(chainId)
      if (resolved == null) {
        return errorResult(`Unknown chain "${chainId}". Use a chain ID (1, 137, 10, 42161, 8453) or name (ethereum, polygon, optimism, arbitrum, base).`)
      }
      try {
        const tokens = await sdk.getSupportedTokens(resolved)
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
        'Returns a quoteId, estimated cost, and an expiresAt timestamp. ' +
        'Pass the quoteId to multichain_execute_swap to execute within the 5-minute window. ' +
        'No wallet or targetAddress needed — use this to check costs before committing. ' +
        'IMPORTANT: Quotes expire after 5 minutes — check the expiresAt field and execute promptly. ' +
        'At least one of bzzAmount or nativeAmount must be > 0.',
      inputSchema: {
        sourceChain: chainIdSchema,
        targetAddress: z.string().optional().describe('Bee node\'s Gnosis address (0x...). Optional for quotes — can be provided later at execution time. Find via Bee API (/addresses endpoint) or swarm_mcp.'),
        bzzAmount: z.number().optional().describe('Amount of xBZZ (Swarm storage token) to deliver. In whole BZZ units. Defaults to 0.'),
        nativeAmount: z.number().optional().describe('Amount of xDAI (for transaction fees) to deliver. In whole DAI units. Defaults to 0.'),
        sourceToken: z.string().optional().describe('Token address to pay with. Defaults to native token (ETH). Use multichain_get_supported_tokens to find options like USDC.'),
      },
    },
    async ({ sourceChain, targetAddress, bzzAmount, nativeAmount, sourceToken }) => {
      const resolvedChain = resolveChainId(sourceChain)
      if (resolvedChain == null) {
        return errorResult(`Unknown chain "${sourceChain}". Use a chain ID (1, 137, 10, 42161, 8453) or name (ethereum, polygon, optimism, arbitrum, base).`)
      }
      try {
        const quote = await sdk.getQuote({
          sourceChain: resolvedChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}` | undefined,
          bzzAmount,
          nativeAmount,
          sourceToken: sourceToken as `0x${string}` | undefined,
        })

        const quoteId = Strings.randomHex(16)
        const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString()
        quoteStore.set(quoteId, { quote, expiresAt: Date.now() + QUOTE_TTL_MS })

        return jsonResult({
          quoteId,
          sourceTokenAmount: quote.sourceTokenAmount.toDecimalString(),
          estimatedUsdValue: quote.estimatedUsdValue,
          bzzUsdPrice: quote.bzzUsdPrice,
          expiresInSeconds: 300,
          expiresAt,
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
        'If targetAddress was not provided in the quote, you must provide it here. ' +
        'Requires a configured funding wallet (PRIVATE_KEY) — use multichain_wallet_status to check.',
      inputSchema: {
        quoteId: z.string().describe('Quote ID from multichain_get_quote'),
        targetAddress: z.string().optional().describe('Bee node\'s Gnosis address (0x...). Required if not provided in the original quote.'),
      },
    },
    async ({ quoteId, targetAddress }) => {
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
        const result = await sdk.executeSwap(stored.quote, wallet, undefined, targetAddress as `0x${string}` | undefined)
        recoveryStore.set(result.temporaryAddress, {
          temporaryAddress: result.temporaryAddress,
          temporaryPrivateKey: result.temporaryPrivateKey,
          createdAt: new Date().toISOString(),
          operation: 'swap',
          sourceChain: stored.quote.request.sourceChain,
          targetAddress: (targetAddress ?? stored.quote.request.targetAddress) as string | undefined,
        })
        return jsonResult({
          status: 'completed',
          steps: result.steps,
          metadata: result.metadata,
          temporaryAddress: result.temporaryAddress,
          recoveryNote: 'If the swap failed mid-execution, use multichain_list_recovery_wallets to access recovery info.',
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
        sourceChain: chainIdSchema,
        targetAddress: z.string().describe('Bee node\'s Gnosis address (0x...). Find via Bee API (/addresses endpoint) or swarm_mcp.'),
        bzzAmount: z.number().optional().describe('Amount of xBZZ (Swarm storage token) to deliver. In whole BZZ units. Defaults to 0.'),
        nativeAmount: z.number().optional().describe('Amount of xDAI (for transaction fees) to deliver. In whole DAI units. Defaults to 0.'),
        sourceToken: z.string().optional().describe('Token address to pay with. Defaults to native token (ETH). Use multichain_get_supported_tokens to find options like USDC.'),
      },
    },
    async ({ sourceChain, targetAddress, bzzAmount, nativeAmount, sourceToken }) => {
      const resolvedChain = resolveChainId(sourceChain)
      if (resolvedChain == null) {
        return errorResult(`Unknown chain "${sourceChain}". Use a chain ID (1, 137, 10, 42161, 8453) or name (ethereum, polygon, optimism, arbitrum, base).`)
      }
      let wallet
      try {
        wallet = getWallet(resolvedChain)
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }

      try {
        const result = await sdk.swap({
          wallet,
          sourceChain: resolvedChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}`,
          bzzAmount,
          nativeAmount,
          sourceToken: sourceToken as `0x${string}` | undefined,
        })
        recoveryStore.set(result.temporaryAddress, {
          temporaryAddress: result.temporaryAddress,
          temporaryPrivateKey: result.temporaryPrivateKey,
          createdAt: new Date().toISOString(),
          operation: 'swap',
          sourceChain: resolvedChain,
          targetAddress: targetAddress as string,
        })
        return jsonResult({
          status: 'completed',
          steps: result.steps,
          metadata: result.metadata,
          temporaryAddress: result.temporaryAddress,
          recoveryNote: 'If the swap failed mid-execution, use multichain_list_recovery_wallets to access recovery info.',
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
        sourceChain: chainIdSchema,
        targetAddress: z.string().describe('Bee node\'s Gnosis address (0x...) to receive remaining xDAI. Find via Bee API or swarm_mcp.'),
        batchDepth: z.number().int().min(17).max(24).describe('Storage capacity level (17-24). 20 (~682 MB) is recommended for most use cases.'),
        batchDurationDays: z.number().positive().describe('How many days the storage should last.'),
        nativeAmount: z.number().optional().describe('Extra xDAI (for transaction fees) to deliver alongside the batch. Defaults to 0.'),
      },
    },
    async ({ sourceChain, targetAddress, batchDepth, batchDurationDays, nativeAmount }) => {
      const resolvedChain = resolveChainId(sourceChain)
      if (resolvedChain == null) {
        return errorResult(`Unknown chain "${sourceChain}". Use a chain ID (1, 137, 10, 42161, 8453) or name (ethereum, polygon, optimism, arbitrum, base).`)
      }
      let wallet
      try {
        wallet = getWallet(resolvedChain)
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }

      try {
        const result = await sdk.createBatch({
          wallet,
          sourceChain: resolvedChain as SupportedChainId,
          targetAddress: targetAddress as `0x${string}`,
          batchDepth,
          batchDurationDays,
          nativeAmount,
        })
        recoveryStore.set(result.temporaryAddress, {
          temporaryAddress: result.temporaryAddress,
          temporaryPrivateKey: result.temporaryPrivateKey,
          createdAt: new Date().toISOString(),
          operation: 'batch',
          sourceChain: resolvedChain,
          targetAddress: targetAddress as string,
        })
        return jsonResult({
          status: 'completed',
          batchId: result.batchId,
          blockNumber: result.blockNumber,
          steps: result.steps,
          metadata: result.metadata,
          temporaryAddress: result.temporaryAddress,
          recoveryNote: 'If the operation failed mid-execution, use multichain_list_recovery_wallets to access recovery info.',
        })
      } catch (error: unknown) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  )

  // 10. multichain_list_recovery_wallets
  server.registerTool(
    'multichain_list_recovery_wallets',
    {
      title: 'List Recovery Wallets',
      description:
        'List temporary wallets from previous swap/batch operations in this session. ' +
        'If a swap failed mid-execution, funds may be stuck in a temporary wallet on Gnosis chain. ' +
        'This tool reveals the private keys needed to recover those funds. ' +
        'WARNING: Private keys are sensitive — do not share them or log them unnecessarily.',
    },
    async () => {
      if (recoveryStore.size === 0) {
        return jsonResult({
          wallets: [],
          message: 'No recovery wallets from this session. Recovery info is only available for swaps executed in the current MCP server session.',
        })
      }

      const wallets = Array.from(recoveryStore.values()).map(entry => ({
        temporaryAddress: entry.temporaryAddress,
        temporaryPrivateKey: entry.temporaryPrivateKey,
        createdAt: entry.createdAt,
        operation: entry.operation,
        sourceChain: entry.sourceChain,
        targetAddress: entry.targetAddress ?? null,
      }))

      return jsonResult({
        wallets,
        warning: 'These private keys control temporary wallets that may hold funds. Keep them secure and do not share them.',
      })
    },
  )

  return server
}
