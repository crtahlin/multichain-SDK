# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@multichain-dev/multichain-sdk` is a headless SDK that enables AI agents to perform cross-chain token swaps to Gnosis chain (xDAI/xBZZ) and create Swarm postage batches. No UI, no browser dependencies — pure Node.js.

### Related Repositories

- **Widget** (React UI, source of step logic): [ethersphere/multichain-widget](https://github.com/ethersphere/multichain-widget) / [crtahlin/multichain-widget](https://github.com/crtahlin/multichain-widget)
- **Library** (Gnosis chain primitives, used as dependency): [ethersphere/multichain-library](https://github.com/ethersphere/multichain-library) — published as `@upcoming/multichain-library`

### Architecture Relationship

```
@upcoming/multichain-library   (dependency — low-level Gnosis ops)
       ↓
@multichain-dev/multichain-sdk       (this repo — orchestration + agent interface)
       ↑
Agent wallets (Coinbase AgentKit, Turnkey, raw keys, etc.)
```

The widget and SDK are siblings that share the same dependency (`multichain-library`) but serve different audiences: widget for browser users, SDK for AI agents.

## Commands

- **Install:** `pnpm install`
- **Build:** `pnpm build` (tsup, outputs CJS + ESM + declarations to `dist/`)
- **Type check:** `pnpm check` (`tsc --noEmit`)
- **Test:** `pnpm test` (vitest)
- **MCP server:** `npx @multichain-dev/multichain-sdk-mcp`

## Dependencies

| Package | Purpose |
|---|---|
| `@upcoming/multichain-library` | Gnosis chain operations: balances, SushiSwap, transfers, batch creation, price feeds |
| `@relayprotocol/relay-sdk` | Cross-chain EVM swaps (quote + execute) |
| `cafe-utility` | `Solver` (step orchestrator), `FixedPointNumber`, `Strings`, `Elliptic` |
| `viem` | EVM wallet/transaction types, chain definitions |
| `@solana/web3.js` | Optional — Solana wallet/transaction support |
| `@modelcontextprotocol/sdk` | Optional peer dep — MCP server |

No React, wagmi, RainbowKit, or browser dependencies.

## Source Structure

```
src/
  index.ts              # Barrel export
  MultichainSDK.ts      # Main SDK class — entry point for agents
  types.ts              # All public interfaces (wallets, requests, quotes, results)
  config.ts             # Chain definitions, RPC endpoints (configurable)
  errors.ts             # Typed error classes for agent error handling

  wallets/
    EvmPrivateKeyWallet.ts      # Raw hex private key → viem WalletClient
    EvmWalletClientAdapter.ts   # Wraps any viem WalletClient
    SolanaKeypairWallet.ts      # Raw Solana keypair (lazy-imports @solana/web3.js)

  providers/
    RelayProvider.ts    # EVM → Gnosis via Relay Protocol (quote + token list)
    DeBridgeProvider.ts # Solana → Gnosis via deBridge DLN REST API (Phase 4)

  flows/
    EvmToGnosisFlow.ts      # Relay bridge + GnosisOnChainFlow
    SolanaToGnosisFlow.ts   # deBridge bridge + GnosisOnChainFlow (Phase 4)
    GnosisOnChainFlow.ts    # Shared: SushiSwap xDAI→xBZZ + transfer remainder

  steps/                # Adapted from widget (React callbacks removed)
    RelayStep.ts        # Cross-chain swap via Relay Protocol
    RelaySyncStep.ts    # Wait for xDAI arrival on Gnosis
    SushiStep.ts        # Swap xDAI → xBZZ on SushiSwap
    SushiSyncStep.ts    # Wait for BZZ balance increase
    TransferStep.ts     # Transfer remaining xDAI to target
    TransferSyncStep.ts # Wait for transfer confirmation
    ApproveBzzStep.ts   # Approve xBZZ for batch contract (batch mode)
    CreateBatchStep.ts  # Create Swarm postage batch (batch mode)
    Mocked*.ts          # Mocked variants for testing (no real blockchain txs)

  mcp/
    server.ts           # MCP server implementation
    tools.ts            # MCP tool definitions (9 tools)
    cli.ts              # CLI entry point: npx @multichain-dev/multichain-sdk-mcp
```

## Key Concepts

### Wallet Adapter Pattern

Agents use different wallet providers. The SDK defines a minimal interface:

```typescript
interface EvmWalletAdapter {
  type: 'evm'
  getAddress(): Promise<`0x${string}`>
  getChainId(): Promise<number>
  sendTransaction(tx): Promise<`0x${string}`>
  getWalletClient(): Promise<WalletClient>
}
```

Any wallet provider (Coinbase AgentKit, Turnkey, Lit Protocol, raw keys) can implement this. The SDK ships built-in adapters for private keys and viem WalletClient.

### Step Orchestration (Solver Pattern)

Uses `Solver` from `cafe-utility`. Each step has:
- `name`: string identifier
- `precondition?`: async gate (if false, step is skipped)
- `action`: async function receiving a shared `Map<string, unknown>` context
- Returns `'retry'` to retry once, or void for success

Steps are added sequentially to a Solver, which executes them in order with hooks:
```typescript
solver.setHooks({ onStatusChange, onStepChange, onError, onFinish })
await solver.execute()
```

### Temporary Wallet

The SDK generates an ephemeral private key in memory. The cross-chain bridge delivers xDAI to this temporary address. The SDK executes Gnosis-side operations (SushiSwap, transfer, batch creation) using this key, then transfers everything to the agent's target address. Agents never need a Gnosis wallet.

Key derivation: `Strings.randomHex(64)` → `Elliptic.privateKeyToPublicKey` → `Elliptic.publicKeyToAddress`

### Two Execution Flows

**Funding flow (6 steps):**
1. Relay cross-swap → xDAI on Gnosis (temporary address)
2. Wait for arrival
3. SushiSwap xDAI → xBZZ (target address)
4. Wait for BZZ arrival
5. Transfer remaining xDAI to target
6. Wait for confirmation

**Batch flow (8 steps):**
1-2. Same Relay bridge
3-4. SushiSwap xDAI → xBZZ (to **temporary** address, not target)
5. Approve xBZZ for postage stamp contract
6. Create postage batch
7-8. Transfer remaining xDAI to target

### Cross-Chain Routing

- **EVM → Gnosis**: Relay Protocol with `EXACT_OUTPUT` trade type, targeting xDAI on chain 100
- **Solana → Gnosis** (Phase 4): deBridge DLN REST API (`https://api.dln.trade`), returns raw Solana `VersionedTransaction`
- Both paths converge at the same GnosisOnChainFlow

## Step Adaptation from Widget

Steps are copied from [multichain-widget/src/steps/](https://github.com/crtahlin/multichain-widget/tree/main/src/steps) with one change:

**Widget pattern** (React):
```typescript
options.setMetadata(previous => ({ ...previous, relay: explorerUrl }))
```

**SDK pattern** (plain callback):
```typescript
options.onMetadata('relay', explorerUrl)
```

`CreateBatchStep` also replaces `window.parent.postMessage(...)` with `options.onBatchCreated?.(...)`.

Sync steps (`RelaySyncStep`, `SushiSyncStep`, `TransferSyncStep`) have no React dependencies and are copied unchanged.

## multichain-library API Reference

The library (`@upcoming/multichain-library`) provides these methods used by the SDK:

| Method | Used In |
|---|---|
| `getGnosisNativeBalance(addr)` | RelaySyncStep, SushiStep, TransferStep |
| `getGnosisBzzBalance(addr)` | SushiStep, TransferStep |
| `waitForGnosisNativeBalanceToIncrease(addr, threshold)` | RelaySyncStep |
| `waitForGnosisNativeBalanceToDecrease(addr, threshold)` | SushiSyncStep, TransferSyncStep |
| `waitForGnosisBzzBalanceToIncrease(addr, threshold)` | SushiSyncStep |
| `swapOnGnosisAuto(opts)` | SushiStep |
| `transferGnosisNative(opts)` | TransferStep |
| `approveGnosisBzz(opts)` | ApproveBzzStep |
| `createBatchGnosis(opts)` | CreateBatchStep |
| `getGnosisTransactionCount(addr)` | ApproveBzzStep |
| `getGnosisTransaction(txHash)` | CreateBatchStep |
| `waitForGnosisTransactionReceipt(txHash)` | SushiStep, TransferStep |
| `getGnosisBzzTokenPrice()` | MultichainSDK.getBzzPrice() |
| `getStoragePriceGnosis()` | MultichainSDK.getStoragePrice() |
| `getTokenPrice(token, chainId)` | Quote price calculation |
| `constants.gnosisChainId` | 100 |
| `constants.nullAddress` | Native token address (0x000...0) |
| `constants.daiDustAmount` | Minimum xDAI to retain |

## Relay Protocol Integration

Quote configuration (from widget's Tab2.tsx):
```typescript
relayClient.actions.getQuote({
  user: sourceAddress,
  recipient: temporaryAddress,
  chainId: sourceChain,        // e.g. 8453 for Base
  toChainId: 100,              // Gnosis
  currency: sourceToken,       // token address or null for native
  toCurrency: '0x0000000000000000000000000000000000000000',
  tradeType: 'EXACT_OUTPUT',
  amount: desiredXdaiAmountWei
})
```

Execution: `relayClient.actions.execute({ quote, wallet, onProgress })` — the `onProgress` callback provides `txHashes: [{ chainId, txHash }]`.

## Supported Source Chains

Ethereum (1), Polygon (137), Optimism (10), Arbitrum (42161), Base (8453). Destination is always Gnosis (100). Solana support via deBridge planned for Phase 4.

## MCP Tools

| Tool | Description | Wallet needed? |
|---|---|---|
| `multichain_wallet_status` | Check funding wallet configuration | No |
| `multichain_get_supported_chains` | List supported source chains | No |
| `multichain_get_supported_tokens` | List tokens on a source chain | No |
| `multichain_get_bzz_price` | BZZ/USD price | No |
| `multichain_calculate_batch_cost` | Estimate storage cost | No |
| `multichain_get_quote` | Preview funding cost (returns quoteId) | No |
| `multichain_execute_swap` | Execute from quoteId | Yes |
| `multichain_swap` | Fund Bee node (one step) | Yes |
| `multichain_create_batch` | Rent Swarm storage | Yes |

## Agent Wallet Compatibility

The wallet adapter interface is compatible with:
- **Coinbase AgentKit / Agentic Wallets** — MPC+TEE, native x402 support
- **Turnkey** — TEE wallets, 50-100ms signing latency
- **Lit Protocol (Vincent)** — decentralized MPC
- **Privy** — TEE + key sharding (now Stripe-owned)
- **Raw private keys** — built-in `EvmPrivateKeyWallet` adapter
- Any viem-compatible `WalletClient` — built-in `EvmWalletClientAdapter`

x402 compatibility: any wallet that can sign EIP-3009 authorizations for x402 payments also works with this SDK's wallet adapter interface.
