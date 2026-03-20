import { System } from 'cafe-utility'

export function createMockedTransferSyncStep() {
  return {
    name: 'transfer-sync',
    transientSkipStepName: 'transfer',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
