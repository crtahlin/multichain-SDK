import { System } from 'cafe-utility'

export function createMockedTransferStep() {
  return {
    name: 'transfer',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
