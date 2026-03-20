import { System } from 'cafe-utility'

export function createMockedSushiSyncStep() {
  return {
    name: 'sushi-sync',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
