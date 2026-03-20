import { MultichainLibrary, xDAI } from '@upcoming/multichain-library'

interface Options {
  library: MultichainLibrary
  temporaryAddress: `0x${string}`
}

export function createTransferSyncStep(options: Options) {
  return {
    name: 'transfer-sync',
    transientSkipStepName: 'transfer',
    action: async (context: Map<string, unknown>) => {
      const daiBefore = xDAI.cast(context.get('daiBefore'))
      await options.library.waitForGnosisNativeBalanceToDecrease(options.temporaryAddress, daiBefore.value)
    },
  }
}
