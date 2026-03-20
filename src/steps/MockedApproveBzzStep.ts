import { System } from 'cafe-utility'

export function createMockedApproveBzzStep() {
  return {
    name: 'approve-bzz',
    action: async (_context: Map<string, unknown>) => {
      await System.sleepMillis(500)
    },
  }
}
