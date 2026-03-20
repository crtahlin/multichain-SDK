import { System } from 'cafe-utility'

export function createMockedRelaySyncStep() {
  return {
    name: 'relay-sync',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
