import { describe, expect, it } from 'vitest'
import * as sdk from '../index'

describe('Barrel exports', () => {
  it('exports MultichainSDK class', () => {
    expect(sdk.MultichainSDK).toBeDefined()
    expect(typeof sdk.MultichainSDK).toBe('function')
  })

  it('exports wallet adapters', () => {
    expect(sdk.EvmPrivateKeyWallet).toBeDefined()
    expect(sdk.EvmWalletClientAdapter).toBeDefined()
  })

  it('exports all error classes', () => {
    expect(sdk.MultichainError).toBeDefined()
    expect(sdk.NoRouteError).toBeDefined()
    expect(sdk.InsufficientBalanceError).toBeDefined()
    expect(sdk.TransactionRejectedError).toBeDefined()
    expect(sdk.StepExecutionError).toBeDefined()
    expect(sdk.QuoteExpiredError).toBeDefined()
    expect(sdk.ConfigurationError).toBeDefined()
    expect(sdk.PriceFetchError).toBeDefined()
  })

  it('exports config utilities', () => {
    expect(sdk.SUPPORTED_CHAINS).toBeDefined()
    expect(sdk.DEFAULT_RPC_URLS).toBeDefined()
    expect(typeof sdk.getExplorerTxUrl).toBe('function')
  })

  it('error classes extend MultichainError', () => {
    expect(new sdk.NoRouteError(1, '0x0')).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.ConfigurationError('test')).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.PriceFetchError('test')).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.StepExecutionError('test')).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.QuoteExpiredError()).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.TransactionRejectedError()).toBeInstanceOf(sdk.MultichainError)
    expect(new sdk.InsufficientBalanceError('1', '0', 'ETH')).toBeInstanceOf(sdk.MultichainError)
  })
})
