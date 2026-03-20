# @upcoming/multichain-sdk

> **Disclaimer:** This software is experimental and provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. This project is under active development and is not intended for production use. Use at your own risk. The authors assume no liability for any damages, loss of funds, or other consequences arising from the use of this software. Always verify transactions and review code before interacting with real blockchain networks or committing real funds.

Headless Node.js SDK that enables AI agents to perform cross-chain token swaps to Gnosis chain (xDAI/xBZZ) and create Swarm postage batches. No UI, no browser dependencies — pure Node.js.

## Installation

```bash
pnpm add @upcoming/multichain-sdk
```

## Quick Start

```typescript
import { MultichainSDK, EvmPrivateKeyWallet } from '@upcoming/multichain-sdk'

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

```typescript
const quote = await sdk.getQuote({
  wallet,
  sourceChain: 8453,
  targetAddress: '0xBeeNode...',
  bzzAmount: 10,
  nativeAmount: 0.5,
})
console.log(`Cost: ${quote.sourceTokenAmount.toDecimalString()} source tokens`)
console.log(`Estimated: $${quote.estimatedUsdValue.toFixed(2)}`)

// Execute only if the user approves
const result = await sdk.executeSwap(quote, wallet)
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
import { NoRouteError, ConfigurationError } from '@upcoming/multichain-sdk'

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

## Fund Recovery

If a swap fails mid-execution, the result includes the `temporaryPrivateKey` for the ephemeral Gnosis wallet. Use this to recover any bridged funds:

```typescript
const result = await sdk.swap(request)
// If flow failed, result.temporaryPrivateKey contains the key
// for the temporary wallet that received bridged xDAI
```

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
@upcoming/multichain-sdk       (this repo — orchestration + agent interface)
       ↑
Agent wallets (Coinbase AgentKit, Turnkey, raw keys, etc.)
```

## License

MIT
