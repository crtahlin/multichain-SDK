import { System } from 'cafe-utility'

export function createMockedRelayStep() {
  return {
    name: 'relay',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
