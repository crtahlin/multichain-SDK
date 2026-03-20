import { System } from 'cafe-utility'

export function createMockedSushiStep() {
  return {
    name: 'sushi',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
