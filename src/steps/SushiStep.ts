import { MultichainLibrary, xDAI } from '@upcoming/multichain-library'

interface Options {
  library: MultichainLibrary
  bzzUsdValue: number
  temporaryAddress: `0x${string}`
  temporaryPrivateKey: `0x${string}`
  targetAddress: `0x${string}`
  onMetadata: (key: string, value: string) => void
}

export function createSushiStep(options: Options) {
  return {
    name: 'sushi',
    precondition: async () => {
      return options.bzzUsdValue > 0
    },
    action: async (context: Map<string, unknown>, zeroIndexedAttemptNumber: number) => {
      const daiBefore = await options.library.getGnosisNativeBalance(options.temporaryAddress)
      const bzzBefore = await options.library.getGnosisBzzBalance(options.targetAddress)
      context.set('daiBefore', daiBefore)
      context.set('bzzBefore', bzzBefore)
      const plannedDai = xDAI.fromFloat(options.bzzUsdValue)
      const amount =
        daiBefore.subtract(options.library.constants.daiDustAmount).compare(plannedDai) === -1
          ? daiBefore.subtract(options.library.constants.daiDustAmount)
          : plannedDai
      const tx = await options.library.swapOnGnosisAuto({
        amount: amount.toString(),
        originPrivateKey: options.temporaryPrivateKey,
        to: options.targetAddress,
      })
      options.onMetadata('sushi', `https://gnosisscan.io/tx/${tx}`)
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
