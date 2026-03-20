import { Strings, System } from 'cafe-utility'

interface Options {
  batchAmount: string | bigint
  batchDepth: number
  onBatchCreated?: (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => void
}

export function createMockedCreateBatchStep(options: Options) {
  return {
    name: 'create-batch',
    action: async (context: Map<string, unknown>) => {
      await System.sleepMillis(500)
      const batchId = `0x${Strings.randomHex(64)}`
      const message = {
        batchId,
        depth: options.batchDepth,
        amount: options.batchAmount.toString(),
        blockNumber: '0x2aa1944',
      }
      console.log('Postage batch created', message)
      options.onBatchCreated?.(message)
      context.set('batchId', batchId)
    },
  }
}
