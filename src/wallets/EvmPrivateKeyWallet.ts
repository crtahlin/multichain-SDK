import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { EvmWalletAdapter, SupportedChainId } from '../types'
import { DEFAULT_RPC_URLS, SUPPORTED_CHAINS } from '../config'

interface EvmPrivateKeyWalletOptions {
  /** Hex-encoded private key (with or without 0x prefix) */
  privateKey: `0x${string}`
  /** Source chain ID */
  chainId: SupportedChainId
  /** Custom RPC URL (defaults to DEFAULT_RPC_URLS[chainId]) */
  rpcUrl?: string
}

/**
 * Wallet adapter backed by a raw private key.
 *
 * @example
 * ```typescript
 * const wallet = new EvmPrivateKeyWallet({
 *   privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
 *   chainId: 8453
 * })
 * const result = await sdk.swap({ wallet, sourceChain: 8453, targetAddress: '0x...', bzzAmount: 10 })
 * ```
 */
export class EvmPrivateKeyWallet implements EvmWalletAdapter {
  readonly type = 'evm' as const
  private readonly account
  private readonly client

  constructor(options: EvmPrivateKeyWalletOptions) {
    this.account = privateKeyToAccount(options.privateKey)
    const chain = SUPPORTED_CHAINS[options.chainId]
    const rpcUrl = options.rpcUrl || DEFAULT_RPC_URLS[options.chainId]
    this.client = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    })
  }

  async getAddress(): Promise<`0x${string}`> {
    return this.account.address
  }

  async getChainId(): Promise<number> {
    return this.client.chain!.id
  }

  async sendTransaction(tx: { to: `0x${string}`; value: bigint }): Promise<`0x${string}`> {
    return this.client.sendTransaction({
      to: tx.to,
      value: tx.value,
    })
  }

  async getWalletClient() {
    return this.client
  }
}
