# @multichain-dev/multichain-sdk

> **Disclaimer:** This software is experimental and provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. This project is under active development and is not intended for production use. Use at your own risk. The authors assume no liability for any damages, loss of funds, or other consequences arising from the use of this software. Always verify transactions and review code before interacting with real blockchain networks or committing real funds.

Headless Node.js SDK that enables AI agents to perform cross-chain token swaps to Gnosis chain (xDAI/xBZZ) and create Swarm postage batches. No UI, no browser dependencies — pure Node.js.

## Installation

This package is not yet published to npm. Install from GitHub:

```bash
git clone https://github.com/crtahlin/multichain-SDK.git
cd multichain-SDK
pnpm install
pnpm build
```

To use it as a dependency in another project, link it locally:

```bash
# In the multichain-SDK directory
pnpm link --global

# In your project
pnpm link --global @multichain-dev/multichain-sdk
```

## Quick Start

```typescript
import { MultichainSDK, EvmPrivateKeyWallet } from '@multichain-dev/multichain-sdk'

const sdk = new MultichainSDK()
const wallet = new EvmPrivateKeyWallet({
  privateKey: '0x...',
  chainId: 8453, // Base
})

// Fund a Bee node wallet with xBZZ + xDAI
const result = await sdk.swap({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xYourBeeNodeAddress...',
  bzzAmount: 10,
  nativeAmount: 0.5,
})

console.log('Swap complete:', result.steps)
```

## Use Cases

### 1. Fund a wallet with xBZZ and xDAI

```typescript
const result = await sdk.swap({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xBeeNode...',
  bzzAmount: 10,
  nativeAmount: 0.5,
})
```

### 2. Deposit xDAI only (e.g., for chequebook funding)

```typescript
const result = await sdk.swap({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xBeeNode...',
  nativeAmount: 2.0,
})
```

### 3. Create a Swarm postage batch

```typescript
const result = await sdk.createBatch({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xBeeNode...',
  batchDepth: 20,
  batchDurationDays: 30,
})
console.log('Batch ID:', result.batchId)
```

### 4. Preview costs before executing

No wallet or private key needed — `targetAddress` is optional for quotes:

```typescript
const quote = await sdk.getQuote({
  sourceChain: 8453,
  bzzAmount: 10,
  nativeAmount: 0.5,
})
console.log(`Cost: ${quote.sourceTokenAmount.toDecimalString()} source tokens`)
console.log(`Estimated: $${quote.estimatedUsdValue.toFixed(2)}`)

// Execute with targetAddress provided at execution time
const result = await sdk.executeSwap(quote, wallet, undefined, '0xBeeNode...')
```

### 5. Discover supported chains and tokens

```typescript
// List supported source chains
const chains = sdk.getSupportedChains()
// [{ id: 1, name: 'Ethereum' }, { id: 8453, name: 'Base' }, ...]

// List available tokens on a chain
const tokens = await sdk.getSupportedTokens(8453)
// [{ address: '0x...', symbol: 'ETH', name: 'Ether', decimals: 18 }, ...]
```

## Supported Chains

| Chain | ID |
|---|---|
| Ethereum | 1 |
| Polygon | 137 |
| Optimism | 10 |
| Arbitrum | 42161 |
| Base | 8453 |

Destination is always Gnosis (chain 100).

## Wallet Adapters

The SDK defines a minimal `EvmWalletAdapter` interface that any wallet provider can implement:

```typescript
interface EvmWalletAdapter {
  type: 'evm'
  getAddress(): Promise<`0x${string}`>
  getChainId(): Promise<number>
  sendTransaction(tx: { to: `0x${string}`; value: bigint }): Promise<`0x${string}`>
  getWalletClient(): Promise<WalletClient>
}
```

**Built-in adapters:**

- `EvmPrivateKeyWallet` — raw hex private key (most common for agents)
- `EvmWalletClientAdapter` — wraps any viem `WalletClient` (Coinbase AgentKit, Turnkey, Lit Protocol, etc.)

## Callbacks

All callbacks are optional — `await sdk.swap(request)` works without them:

```typescript
const result = await sdk.swap(request, {
  onStatusChange: (status) => console.log('Status:', status),
  onStepChange: (steps) => console.log('Steps:', steps),
  onMetadata: (key, value) => console.log(`${key}: ${value}`),
  onError: (error) => console.error('Error:', error),
})
```

## Error Handling

All errors extend `MultichainError` with a machine-readable `code`:

```typescript
import { NoRouteError, ConfigurationError } from '@multichain-dev/multichain-sdk'

try {
  await sdk.swap(request)
} catch (error) {
  if (error instanceof NoRouteError) {
    console.log('No route found, try a different chain or token')
  }
}
```

| Error | Code | When |
|---|---|---|
| `NoRouteError` | `NO_ROUTE` | No cross-chain route available |
| `InsufficientBalanceError` | `INSUFFICIENT_BALANCE` | Not enough source tokens |
| `TransactionRejectedError` | `TRANSACTION_REJECTED` | Wallet rejected signing |
| `StepExecutionError` | `STEP_FAILED` | A flow step failed |
| `QuoteExpiredError` | `QUOTE_EXPIRED` | Quote used after expiry |
| `ConfigurationError` | `CONFIGURATION_ERROR` | Invalid chain or params |
| `PriceFetchError` | `PRICE_FETCH_FAILED` | Price API failure |

## Mocked Mode

For testing and development, create the SDK with `mocked: true` to simulate all blockchain operations without real transactions:

```typescript
const sdk = new MultichainSDK({ mocked: true })

// All operations work normally but don't touch any blockchain
const result = await sdk.swap({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xBeeNode...',
  bzzAmount: 10,
})
// result.steps → all 6 steps completed (simulated)
```

Mocked mode is used in the example scripts — add `MOCKED=true` to any example command.

## Batch Depth & Duration

When creating postage batches, `batchDepth` determines storage capacity:

| Depth | Storage Capacity |
|---|---|
| 17 | ~44 kB |
| 18 | ~6.6 MB |
| 19 | ~111 MB |
| 20 | ~682 MB |
| 21 | ~2.6 GB |
| 22 | ~7.7 GB |
| 23 | ~19.8 GB |
| 24 | ~46.7 GB |

`batchDurationDays` determines how long the batch remains valid. Cost scales linearly with duration and exponentially with depth.

## Fund Recovery

If a swap fails mid-execution, the result includes the `temporaryPrivateKey` for the ephemeral Gnosis wallet. Use this to recover any bridged funds:

```typescript
const result = await sdk.swap(request)
// If flow failed, result.temporaryPrivateKey contains the key
// for the temporary wallet that received bridged xDAI
```

## MCP Server

The SDK includes an MCP (Model Context Protocol) server that exposes all functionality as tools for AI agents like Claude.

### Setup with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "multichain": {
      "command": "node",
      "args": ["/absolute/path/to/multichain-SDK/dist/mcp/cli.js"],
      "env": {
        "PRIVATE_KEY": "0x...",
        "SOURCE_CHAIN": "8453"
      }
    }
  }
}
```

`SOURCE_CHAIN` is optional — if set, it's the default source chain. You can override it per tool call by specifying `sourceChain`.

### Available Tools

| Tool | Description | Wallet needed? |
|---|---|---|
| `multichain_wallet_status` | Check funding wallet configuration and balance | No |
| `multichain_wallet_balance` | Check native + ERC-20 balances across all chains (optional `token` param) | PRIVATE_KEY only |
| `multichain_get_supported_chains` | List supported source chains | No |
| `multichain_get_supported_tokens` | List tokens on a source chain | No |
| `multichain_get_bzz_price` | Get BZZ/USD price | No |
| `multichain_calculate_batch_cost` | Estimate storage cost | No |
| `multichain_get_quote` | Preview funding cost (returns quoteId + expiresAt timestamp) | No |
| `multichain_execute_swap` | Execute from quoteId (accepts targetAddress if not in quote) | Yes |
| `multichain_swap` | Fund Bee node (one step) | Yes |
| `multichain_create_batch` | Rent Swarm storage | Yes |
| `multichain_list_recovery_wallets` | List temporary wallets for fund recovery (if swap failed mid-execution) | No |

Tools marked "Wallet needed" require `PRIVATE_KEY` environment variable. `SOURCE_CHAIN` is optional — if not set, specify the chain in each tool call.

### Agent-Friendly Features

- **Chain names accepted:** All chain parameters accept names (`"base"`, `"ethereum"`, `"polygon"`, `"optimism"`, `"arbitrum"`) alongside numeric IDs
- **Optional targetAddress for quotes:** `multichain_get_quote` works without `targetAddress` — provide it later at execution time via `multichain_execute_swap`
- **Quote expiry timestamps:** Quotes include `expiresAt` (ISO 8601) in addition to `expiresInSeconds`

> **Agent frameworks (LangChain, CrewAI, Vercel AI SDK, etc.):** Environment variables set at the process level are shared automatically across all MCP servers — no need to duplicate keys in per-server config blocks. The `env` block above is only needed for Claude Desktop.

## Examples

The `examples/` directory contains runnable scripts demonstrating common SDK use cases:

| Example | Description |
|---|---|
| [`quote-preview.ts`](examples/quote-preview.ts) | Get a cross-chain swap quote without executing — preview costs before committing funds |
| [`fund-bee-node.ts`](examples/fund-bee-node.ts) | Full funding flow with step-by-step progress callbacks — bridge, swap, and transfer |
| [`create-batch.ts`](examples/create-batch.ts) | Cross-chain swap + Swarm postage batch creation in one operation (8-step flow) |
| [`mock-llm-agent.ts`](examples/mock-llm-agent.ts) | Simulated AI agent using tool-calling pattern — works with Claude, OpenAI, LangChain, etc. |
| [`discover-chains-tokens.ts`](examples/discover-chains-tokens.ts) | List supported chains, find tokens on a chain, and get a quote paying with USDC |

Run any example with:

```bash
npx tsx examples/discover-chains-tokens.ts                               # No wallet needed
npx tsx examples/quote-preview.ts                                        # No wallet needed
PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/fund-bee-node.ts
PRIVATE_KEY=0x... TARGET_ADDRESS=0x... npx tsx examples/create-batch.ts
PRIVATE_KEY=0x... npx tsx examples/mock-llm-agent.ts
```

Add `MOCKED=true` to run without real blockchain transactions.

## Development

```bash
pnpm install
pnpm check        # Type check (tsc --noEmit)
pnpm build        # Build CJS + ESM + declarations
pnpm test         # Run tests (vitest)
```

## Architecture

```
@upcoming/multichain-library   (dependency — low-level Gnosis ops)
       ↓
@multichain-dev/multichain-sdk       (this repo — orchestration + agent interface)
       ↑
Agent wallets (Coinbase AgentKit, Turnkey, raw keys, etc.)
```

## Acknowledgements

This SDK is based on and adapted from work by the [Ethersphere](https://github.com/ethersphere) team:

- **[multichain-widget](https://github.com/ethersphere/multichain-widget)** — The original React UI for cross-chain swaps to Gnosis. The SDK's step orchestration logic (`src/steps/`) was adapted from the widget's step implementations, with React/browser dependencies replaced by plain Node.js callbacks. The batch cost calculation (`getStampCost`) also originates from the widget's `Utility.ts`.

- **[multichain-library](https://github.com/ethersphere/multichain-library)** — Published as `@upcoming/multichain-library`. Provides the low-level Gnosis chain primitives (balances, SushiSwap, transfers, batch creation, price feeds) that both the widget and this SDK depend on.

The widget and SDK are siblings — they share the same dependency (`multichain-library`) but serve different audiences: the widget targets browser users, while this SDK targets AI agents and headless Node.js environments.

## License

ISC — see [LICENSE](LICENSE).

This project uses the same license as its upstream dependencies ([multichain-widget](https://github.com/ethersphere/multichain-widget) and [multichain-library](https://github.com/ethersphere/multichain-library), both ISC).
