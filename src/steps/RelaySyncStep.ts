import { MultichainLibrary, xDAI } from '@upcoming/multichain-library'

interface Options {
  library: MultichainLibrary
  temporaryAddress: `0x${string}`
}

export function createRelaySyncStep(options: Options) {
  return {
    name: 'relay-sync',
    transientSkipStepName: 'relay',
    action: async (context: Map<string, unknown>) => {
      const daiBefore = xDAI.cast(context.get('daiBefore'))
      await options.library.waitForGnosisNativeBalanceToIncrease(options.temporaryAddress, daiBefore.value)
    },
  }
}
