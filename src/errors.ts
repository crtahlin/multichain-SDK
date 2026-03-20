/** Base error class for all SDK errors with machine-readable code */
export class MultichainError extends Error {
  readonly code: string
  readonly cause?: Error

  constructor(message: string, code: string, cause?: Error) {
    super(message)
    this.name = 'MultichainError'
    this.code = code
    this.cause = cause
  }
}

/** Relay Protocol found no routes for the requested swap */
export class NoRouteError extends MultichainError {
  constructor(sourceChain: number, sourceToken: string, cause?: Error) {
    super(
      `No route found from chain ${sourceChain} (token ${sourceToken}) to Gnosis. ` +
      `Try a different source chain or token.`,
      'NO_ROUTE',
      cause
    )
    this.name = 'NoRouteError'
  }
}

/** Source wallet does not have enough tokens to cover the swap */
export class InsufficientBalanceError extends MultichainError {
  constructor(required: string, available: string, symbol: string) {
    super(
      `Insufficient balance: need ${required} ${symbol} but only ${available} available.`,
      'INSUFFICIENT_BALANCE'
    )
    this.name = 'InsufficientBalanceError'
  }
}

/** Wallet rejected the transaction signing request */
export class TransactionRejectedError extends MultichainError {
  constructor(cause?: Error) {
    super(
      'Transaction was rejected by the wallet. The user or wallet provider denied signing.',
      'TRANSACTION_REJECTED',
      cause
    )
    this.name = 'TransactionRejectedError'
  }
}

/** A flow step failed during execution */
export class StepExecutionError extends MultichainError {
  readonly stepName: string

  constructor(stepName: string, cause?: Error) {
    super(
      `Step "${stepName}" failed. If funds were bridged, use the temporaryPrivateKey from the result to recover them.`,
      'STEP_FAILED',
      cause
    )
    this.name = 'StepExecutionError'
    this.stepName = stepName
  }
}

/** Quote was used after its expiry window */
export class QuoteExpiredError extends MultichainError {
  constructor() {
    super(
      'The swap quote has expired. Please request a new quote.',
      'QUOTE_EXPIRED'
    )
    this.name = 'QuoteExpiredError'
  }
}

/** Invalid configuration (unsupported chain, missing parameters, etc.) */
export class ConfigurationError extends MultichainError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR')
    this.name = 'ConfigurationError'
  }
}

/** Failed to fetch BZZ price or storage price */
export class PriceFetchError extends MultichainError {
  constructor(what: string, cause?: Error) {
    super(
      `Failed to fetch ${what}. The price API may be temporarily unavailable.`,
      'PRICE_FETCH_FAILED',
      cause
    )
    this.name = 'PriceFetchError'
  }
}
