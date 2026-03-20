import { MultichainLibrary } from '@upcoming/multichain-library'

interface Options {
  library: MultichainLibrary
  temporaryAddress: `0x${string}`
  temporaryPrivateKey: `0x${string}`
  targetAddress: `0x${string}`
  onMetadata: (key: string, value: string) => void
}

export function createTransferStep(options: Options) {
  return {
    name: 'transfer',
    precondition: async () => {
      const dai = await options.library.getGnosisNativeBalance(options.temporaryAddress)
      const amountToTransfer = dai.subtract(options.library.constants.daiDustAmount)
      return amountToTransfer.value > options.library.constants.daiDustAmount.value
    },
    action: async (context: Map<string, unknown>, zeroIndexedAttemptNumber: number) => {
      const daiBefore = await options.library.getGnosisNativeBalance(options.temporaryAddress)
      context.set('daiBefore', daiBefore)
      const tx = await options.library.transferGnosisNative({
        originPrivateKey: options.temporaryPrivateKey,
        to: options.targetAddress,
        amount: daiBefore.subtract(options.library.constants.daiDustAmount).toString(),
      })
      options.onMetadata('transfer', `https://gnosisscan.io/tx/${tx}`)
      try {
        await options.library.waitForGnosisTransactionReceipt(tx)
      } catch (error) {
        if (zeroIndexedAttemptNumber === 0) {
          return 'retry' as const
        }
        throw error
      }
    },
  }
}
