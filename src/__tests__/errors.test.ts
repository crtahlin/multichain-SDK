import { describe, expect, it } from 'vitest'
import {
  MultichainError,
  NoRouteError,
  InsufficientBalanceError,
  TransactionRejectedError,
  StepExecutionError,
  QuoteExpiredError,
  ConfigurationError,
  PriceFetchError,
} from '../errors'

describe('Error classes', () => {
  it('MultichainError has correct code and is instanceof Error', () => {
    const err = new MultichainError('test', 'TEST_CODE')
    expect(err.code).toBe('TEST_CODE')
    expect(err.message).toBe('test')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(MultichainError)
  })

  it('MultichainError preserves cause', () => {
    const cause = new Error('root cause')
    const err = new MultichainError('test', 'TEST', cause)
    expect(err.cause).toBe(cause)
  })

  it('NoRouteError has NO_ROUTE code', () => {
    const err = new NoRouteError(8453, '0x0000000000000000000000000000000000000000')
    expect(err.code).toBe('NO_ROUTE')
    expect(err).toBeInstanceOf(MultichainError)
    expect(err).toBeInstanceOf(NoRouteError)
    expect(err.message).toContain('8453')
  })

  it('InsufficientBalanceError has INSUFFICIENT_BALANCE code', () => {
    const err = new InsufficientBalanceError('1.5', '0.5', 'ETH')
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
    expect(err).toBeInstanceOf(MultichainError)
    expect(err.message).toContain('1.5')
    expect(err.message).toContain('0.5')
    expect(err.message).toContain('ETH')
  })

  it('TransactionRejectedError has TRANSACTION_REJECTED code', () => {
    const err = new TransactionRejectedError()
    expect(err.code).toBe('TRANSACTION_REJECTED')
    expect(err).toBeInstanceOf(MultichainError)
  })

  it('StepExecutionError has STEP_FAILED code and stepName', () => {
    const err = new StepExecutionError('relay')
    expect(err.code).toBe('STEP_FAILED')
    expect(err.stepName).toBe('relay')
    expect(err).toBeInstanceOf(MultichainError)
    expect(err.message).toContain('relay')
    expect(err.message).toContain('temporaryPrivateKey')
  })

  it('QuoteExpiredError has QUOTE_EXPIRED code', () => {
    const err = new QuoteExpiredError()
    expect(err.code).toBe('QUOTE_EXPIRED')
    expect(err).toBeInstanceOf(MultichainError)
  })

  it('ConfigurationError has CONFIGURATION_ERROR code', () => {
    const err = new ConfigurationError('bad chain')
    expect(err.code).toBe('CONFIGURATION_ERROR')
    expect(err).toBeInstanceOf(MultichainError)
    expect(err.message).toBe('bad chain')
  })

  it('PriceFetchError has PRICE_FETCH_FAILED code', () => {
    const cause = new Error('timeout')
    const err = new PriceFetchError('BZZ price', cause)
    expect(err.code).toBe('PRICE_FETCH_FAILED')
    expect(err).toBeInstanceOf(MultichainError)
    expect(err.cause).toBe(cause)
  })

  it('errors can be caught with instanceof in catch blocks', () => {
    try {
      throw new NoRouteError(1, '0x0')
    } catch (error) {
      expect(error).toBeInstanceOf(NoRouteError)
      expect(error).toBeInstanceOf(MultichainError)
      expect(error).toBeInstanceOf(Error)
    }
  })
})
