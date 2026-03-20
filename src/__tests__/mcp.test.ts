import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '../mcp/server'

/**
 * Creates a linked pair of in-memory transports for testing.
 * Messages sent on one are received by the other.
 */
function createLinkedTransports(): [Transport, Transport] {
  let transportA: Transport
  let transportB: Transport

  transportA = {
    async start() {},
    async send(message: JSONRPCMessage) {
      transportB.onmessage?.(message)
    },
    async close() {
      transportA.onclose?.()
    },
  }

  transportB = {
    async start() {},
    async send(message: JSONRPCMessage) {
      transportA.onmessage?.(message)
    },
    async close() {
      transportB.onclose?.()
    },
  }

  return [transportA, transportB]
}

describe('MCP Server', () => {
  let client: Client
  let closeServer: () => Promise<void>

  beforeAll(async () => {
    const server = createMcpServer()
    const [clientTransport, serverTransport] = createLinkedTransports()

    client = new Client({ name: 'test-client', version: '1.0.0' })

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    closeServer = async () => {
      await client.close()
      await server.close()
    }
  })

  afterAll(async () => {
    await closeServer()
  })

  describe('tool listing', () => {
    it('lists all 9 tools', async () => {
      const result = await client.listTools()
      expect(result.tools).toHaveLength(9)
    })

    it('includes all expected tool names', async () => {
      const result = await client.listTools()
      const names = result.tools.map((t) => t.name)
      expect(names).toContain('multichain_wallet_status')
      expect(names).toContain('multichain_get_supported_chains')
      expect(names).toContain('multichain_get_supported_tokens')
      expect(names).toContain('multichain_get_bzz_price')
      expect(names).toContain('multichain_calculate_batch_cost')
      expect(names).toContain('multichain_get_quote')
      expect(names).toContain('multichain_execute_swap')
      expect(names).toContain('multichain_swap')
      expect(names).toContain('multichain_create_batch')
    })
  })

  describe('wallet status tool', () => {
    it('returns configured: false when no env vars are set', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      delete process.env.PRIVATE_KEY
      delete process.env.SOURCE_CHAIN

      const result = await client.callTool({ name: 'multichain_wallet_status' })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.configured).toBe(false)
      expect(data.missingVariables).toContain('PRIVATE_KEY')
      expect(data.missingVariables).toContain('SOURCE_CHAIN')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
    })

    it('returns configured: true with valid env vars', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      process.env.SOURCE_CHAIN = '8453'

      const result = await client.callTool({ name: 'multichain_wallet_status' })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.configured).toBe(true)
      expect(data.fundingAddress).toMatch(/^0x/)
      expect(data.sourceChain.id).toBe(8453)
      expect(data.sourceChain.name).toBe('Base')
      expect(data.note).toContain('NOT the Bee node')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
      else delete process.env.SOURCE_CHAIN
    })

    it('returns configured: false with address when only SOURCE_CHAIN is missing', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      delete process.env.SOURCE_CHAIN

      const result = await client.callTool({ name: 'multichain_wallet_status' })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.configured).toBe(false)
      expect(data.fundingAddress).toMatch(/^0x/)
      expect(data.missingVariables).toContain('SOURCE_CHAIN')
      expect(data.missingVariables).not.toContain('PRIVATE_KEY')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
    })

    it('returns error for unsupported SOURCE_CHAIN', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      process.env.SOURCE_CHAIN = '999'

      const result = await client.callTool({ name: 'multichain_wallet_status' })
      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('not a supported chain')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
      else delete process.env.SOURCE_CHAIN
    })

    it('returns error for invalid private key', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = 'not-a-valid-key'
      process.env.SOURCE_CHAIN = '8453'

      const result = await client.callTool({ name: 'multichain_wallet_status' })
      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('invalid')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
      else delete process.env.SOURCE_CHAIN
    })
  })

  describe('read-only tools (no wallet needed)', () => {
    it('multichain_get_supported_chains returns chains', async () => {
      const result = await client.callTool({ name: 'multichain_get_supported_chains' })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.chains).toHaveLength(5)
      expect(data.chains.map((c: { id: number }) => c.id)).toContain(8453)
    })

    it('multichain_get_supported_tokens returns tokens for Base', async () => {
      const result = await client.callTool({
        name: 'multichain_get_supported_tokens',
        arguments: { chainId: 8453 },
      })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.tokens.length).toBeGreaterThan(0)
      expect(data.tokens[0]).toHaveProperty('symbol')
      expect(data.tokens[0]).toHaveProperty('address')
    }, 30000)

    it('multichain_get_supported_tokens returns error for invalid chain', async () => {
      const result = await client.callTool({
        name: 'multichain_get_supported_tokens',
        arguments: { chainId: 999 },
      })
      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('Unsupported chain')
    })

    it('multichain_get_bzz_price returns a price', async () => {
      const result = await client.callTool({ name: 'multichain_get_bzz_price' })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.bzzUsdPrice).toBeGreaterThan(0)
    }, 30000)

    it('multichain_calculate_batch_cost returns cost estimate', async () => {
      const result = await client.callTool({
        name: 'multichain_calculate_batch_cost',
        arguments: { depth: 20, days: 30 },
      })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.bzzAmount).toBeGreaterThan(0)
      expect(data.bzzUsdPrice).toBeGreaterThan(0)
      expect(data.estimatedUsdCost).toBeGreaterThan(0)
      expect(data.depth).toBe(20)
      expect(data.days).toBe(30)
    }, 30000)
  })

  describe('wallet-requiring tools (error without PRIVATE_KEY)', () => {
    it('multichain_execute_swap returns error without PRIVATE_KEY', async () => {
      const originalKey = process.env.PRIVATE_KEY
      delete process.env.PRIVATE_KEY

      const result = await client.callTool({
        name: 'multichain_execute_swap',
        arguments: { quoteId: 'nonexistent' },
      })

      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('funding wallet')
      expect(data.error).toContain('NOT')
      expect(data.error).toContain('Bee node')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
    })

    it('multichain_swap returns error without PRIVATE_KEY', async () => {
      const originalKey = process.env.PRIVATE_KEY
      delete process.env.PRIVATE_KEY

      const result = await client.callTool({
        name: 'multichain_swap',
        arguments: {
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 1,
        },
      })

      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('funding wallet')
      expect(data.error).toContain('NOT')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
    })

    it('multichain_create_batch returns error without PRIVATE_KEY', async () => {
      const originalKey = process.env.PRIVATE_KEY
      delete process.env.PRIVATE_KEY

      const result = await client.callTool({
        name: 'multichain_create_batch',
        arguments: {
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          batchDepth: 20,
          batchDurationDays: 30,
        },
      })

      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('funding wallet')
      expect(data.error).toContain('NOT')

      if (originalKey) process.env.PRIVATE_KEY = originalKey
    })
  })

  describe('quote store', () => {
    it('multichain_get_quote returns a quoteId', async () => {
      const result = await client.callTool({
        name: 'multichain_get_quote',
        arguments: {
          sourceChain: 8453,
          targetAddress: '0x1234567890123456789012345678901234567890',
          bzzAmount: 10,
          nativeAmount: 0.5,
        },
      })
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.quoteId).toBeDefined()
      expect(typeof data.quoteId).toBe('string')
      expect(data.estimatedUsdValue).toBeGreaterThan(0)
      expect(data.expiresInSeconds).toBe(300)
    }, 30000)

    it('multichain_execute_swap rejects nonexistent quoteId', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      process.env.SOURCE_CHAIN = '8453'

      const result = await client.callTool({
        name: 'multichain_execute_swap',
        arguments: { quoteId: 'does-not-exist' },
      })

      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('not found')

      // Restore env
      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
      else delete process.env.SOURCE_CHAIN
    })

    it('multichain_execute_swap returns SOURCE_CHAIN error when only PRIVATE_KEY is set', async () => {
      const originalKey = process.env.PRIVATE_KEY
      const originalChain = process.env.SOURCE_CHAIN
      process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      delete process.env.SOURCE_CHAIN

      const result = await client.callTool({
        name: 'multichain_execute_swap',
        arguments: { quoteId: 'test' },
      })

      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text: string }>
      const data = JSON.parse(content[0].text)
      expect(data.error).toContain('SOURCE_CHAIN')

      // Restore env
      if (originalKey) process.env.PRIVATE_KEY = originalKey
      else delete process.env.PRIVATE_KEY
      if (originalChain) process.env.SOURCE_CHAIN = originalChain
      else delete process.env.SOURCE_CHAIN
    })
  })
})
