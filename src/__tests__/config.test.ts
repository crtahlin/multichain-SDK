import { describe, expect, it } from 'vitest'
import { getExplorerTxUrl, getStampCost, SUPPORTED_CHAINS } from '../config'

describe('Config', () => {
  describe('SUPPORTED_CHAINS', () => {
    it('contains all 5 source chains', () => {
      expect(Object.keys(SUPPORTED_CHAINS)).toHaveLength(5)
      expect(SUPPORTED_CHAINS[1]).toBeDefined()
      expect(SUPPORTED_CHAINS[137]).toBeDefined()
      expect(SUPPORTED_CHAINS[10]).toBeDefined()
      expect(SUPPORTED_CHAINS[42161]).toBeDefined()
      expect(SUPPORTED_CHAINS[8453]).toBeDefined()
    })

    it('chains have correct IDs', () => {
      expect(SUPPORTED_CHAINS[1].id).toBe(1)
      expect(SUPPORTED_CHAINS[137].id).toBe(137)
      expect(SUPPORTED_CHAINS[10].id).toBe(10)
      expect(SUPPORTED_CHAINS[42161].id).toBe(42161)
      expect(SUPPORTED_CHAINS[8453].id).toBe(8453)
    })
  })

  describe('getExplorerTxUrl', () => {
    it('returns correct URL for Ethereum', () => {
      expect(getExplorerTxUrl(1, '0xabc')).toBe('https://etherscan.io/tx/0xabc')
    })

    it('returns correct URL for Gnosis', () => {
      expect(getExplorerTxUrl(100, '0xdef')).toBe('https://gnosisscan.io/tx/0xdef')
    })

    it('returns correct URL for Polygon', () => {
      expect(getExplorerTxUrl(137, '0x123')).toBe('https://polygonscan.com/tx/0x123')
    })

    it('returns correct URL for Optimism', () => {
      expect(getExplorerTxUrl(10, '0x456')).toBe('https://optimistic.etherscan.io/tx/0x456')
    })

    it('returns correct URL for Arbitrum', () => {
      expect(getExplorerTxUrl(42161, '0x789')).toBe('https://arbiscan.io/tx/0x789')
    })

    it('returns correct URL for Base', () => {
      expect(getExplorerTxUrl(8453, '0xfoo')).toBe('https://basescan.org/tx/0xfoo')
    })

    it('falls back to etherscan for unknown chains', () => {
      expect(getExplorerTxUrl(99999, '0xbar')).toBe('https://etherscan.io/tx/0xbar')
    })
  })

  describe('getStampCost', () => {
    it('calculates stamp cost for known inputs', () => {
      const storagePrice = 24000n
      const result = getStampCost(20, 30, storagePrice)
      // amount = (30 * 86_400 / 5) * 24000 + 1 = 518400 * 24000 + 1 = 12441600001
      const expectedAmount = (BigInt(30 * 86_400) / 5n) * storagePrice + 1n
      expect(result.amount).toBe(expectedAmount)
      // bzz = 2^20 * amount (with 16 decimals as FixedPointNumber)
      expect(result.bzz).toBeDefined()
      expect(result.bzz.value).toBe(2n ** 20n * expectedAmount)
    })

    it('handles zero days', () => {
      const result = getStampCost(17, 0, 24000n)
      expect(result.amount).toBe(1n)
    })
  })
})
