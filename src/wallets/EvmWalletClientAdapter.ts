import type { WalletClient } from 'viem'
import type { EvmWalletAdapter } from '../types'

/**
 * Wraps any existing viem WalletClient as an EvmWalletAdapter.
 * Use this for Coinbase AgentKit, Turnkey, Lit Protocol, or any viem-compatible wallet.
 *
 * @example
 * ```typescript
 * import { createWalletClient, http } from 'viem'
 * import { base } from 'viem/chains'
 *
 * const viemClient = createWalletClient({ account, chain: base, transport: http() })
 * const wallet = new EvmWalletClientAdapter(viemClient)
 * const result = await sdk.swap({ wallet, sourceChain: 8453, targetAddress: '0x...', bzzAmount: 10 })
 * ```
 */
export class EvmWalletClientAdapter implements EvmWalletAdapter {
  readonly type = 'evm' as const
  private readonly client: WalletClient

  constructor(client: WalletClient) {
    this.client = client
  }

  async getAddress(): Promise<`0x${string}`> {
    const addresses = await this.client.getAddresses()
    return addresses[0]
  }

  async getChainId(): Promise<number> {
    return this.client.chain!.id
  }

  async sendTransaction(tx: { to: `0x${string}`; value: bigint }): Promise<`0x${string}`> {
    const [account] = await this.client.getAddresses()
    return this.client.sendTransaction({
      account,
      to: tx.to,
      value: tx.value,
      chain: this.client.chain,
    })
  }

  async getWalletClient() {
    return this.client
  }
}
