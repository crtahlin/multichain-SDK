import { MultichainLibrary } from '@upcoming/multichain-library'
import { Strings, Types } from 'cafe-utility'

interface Options {
  library: MultichainLibrary
  temporaryPrivateKey: `0x${string}`
  targetAddress: `0x${string}`
  batchAmount: string | bigint
  batchDepth: number
  onMetadata: (key: string, value: string) => void
  onBatchCreated?: (data: { batchId: string; depth: number; amount: string; blockNumber: string }) => void
}

export function createCreateBatchStep(options: Options) {
  return {
    name: 'create-batch',
    action: async (context: Map<string, unknown>) => {
      const nonce = Types.asNumber(context.get('nonce'))
      const result = await options.library.createBatchGnosis({
        amount: options.batchAmount,
        depth: options.batchDepth,
        originPrivateKey: options.temporaryPrivateKey,
        immutable: false,
        batchNonce: `0x${Strings.randomHex(64)}` as `0x${string}`,
        bucketDepth: 16,
        owner: Types.asHexString(options.targetAddress),
        nonce: nonce + 1,
      })
      const transaction = await options.library.getGnosisTransaction(result.transactionHash)
      options.onMetadata('batch', `https://gnosisscan.io/tx/${result.transactionHash}`)
      const message = {
        batchId: result.batchId,
        depth: options.batchDepth,
        amount: options.batchAmount.toString(),
        blockNumber: transaction.blockNumber,
      }
      console.log('Postage batch created', message)
      options.onBatchCreated?.(message)
      context.set('batchId', result.batchId)
    },
  }
}
