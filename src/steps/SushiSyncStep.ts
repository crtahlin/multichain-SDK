import { MultichainLibrary, xBZZ, xDAI } from '@upcoming/multichain-library'

interface Options {
  library: MultichainLibrary
  temporaryAddress: `0x${string}`
  targetAddress: `0x${string}`
}

export function createSushiSyncStep(options: Options) {
  return {
    name: 'sushi-sync',
    transientSkipStepName: 'sushi',
    action: async (context: Map<string, unknown>) => {
      const daiBefore = xDAI.cast(context.get('daiBefore'))
      const bzzBefore = xBZZ.cast(context.get('bzzBefore'))
      await options.library.waitForGnosisBzzBalanceToIncrease(options.targetAddress, bzzBefore.value)
      await options.library.waitForGnosisNativeBalanceToDecrease(options.temporaryAddress, daiBefore.value)
    },
  }
}
