import { describe, expect, it } from 'vitest'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'
import { EvmPrivateKeyWallet } from '../wallets/EvmPrivateKeyWallet'
import { EvmWalletClientAdapter } from '../wallets/EvmWalletClientAdapter'

// Well-known test private key (Hardhat account #0)
const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const expectedAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

describe('EvmPrivateKeyWallet', () => {
  it('derives correct address from known private key', async () => {
    const wallet = new EvmPrivateKeyWallet({ privateKey: testKey, chainId: 8453 })
    const address = await wallet.getAddress()
    expect(address.toLowerCase()).toBe(expectedAddress.toLowerCase())
  })

  it('returns correct chain ID', async () => {
    const wallet = new EvmPrivateKeyWallet({ privateKey: testKey, chainId: 8453 })
    const chainId = await wallet.getChainId()
    expect(chainId).toBe(8453)
  })

  it('has type evm', () => {
    const wallet = new EvmPrivateKeyWallet({ privateKey: testKey, chainId: 1 })
    expect(wallet.type).toBe('evm')
  })

  it('returns a WalletClient', async () => {
    const wallet = new EvmPrivateKeyWallet({ privateKey: testKey, chainId: 8453 })
    const client = await wallet.getWalletClient()
    expect(client).toBeDefined()
    expect(client.chain!.id).toBe(8453)
  })

  it('works with all supported chain IDs', async () => {
    for (const chainId of [1, 137, 10, 42161, 8453] as const) {
      const wallet = new EvmPrivateKeyWallet({ privateKey: testKey, chainId })
      expect(await wallet.getChainId()).toBe(chainId)
    }
  })

  it('accepts custom RPC URL', async () => {
    const wallet = new EvmPrivateKeyWallet({
      privateKey: testKey,
      chainId: 8453,
      rpcUrl: 'https://custom-rpc.example.com',
    })
    expect(await wallet.getAddress()).toBeTruthy()
  })
})

describe('EvmWalletClientAdapter', () => {
  const account = privateKeyToAccount(testKey)

  it('wraps viem WalletClient and returns correct address', async () => {
    const client = createWalletClient({
      account,
      chain: base,
      transport: http(),
    })
    const adapter = new EvmWalletClientAdapter(client)
    const address = await adapter.getAddress()
    expect(address.toLowerCase()).toBe(expectedAddress.toLowerCase())
  })

  it('returns correct chain ID from underlying client', async () => {
    const client = createWalletClient({
      account,
      chain: mainnet,
      transport: http(),
    })
    const adapter = new EvmWalletClientAdapter(client)
    expect(await adapter.getChainId()).toBe(1)
  })

  it('has type evm', () => {
    const client = createWalletClient({
      account,
      chain: base,
      transport: http(),
    })
    const adapter = new EvmWalletClientAdapter(client)
    expect(adapter.type).toBe('evm')
  })

  it('returns the original WalletClient', async () => {
    const client = createWalletClient({
      account,
      chain: base,
      transport: http(),
    })
    const adapter = new EvmWalletClientAdapter(client)
    const returned = await adapter.getWalletClient()
    expect(returned).toBe(client)
  })
})
