#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server.js'

// MCP uses stdout for JSON-RPC transport. Any console.log from dependencies
// (e.g. Relay SDK progress callbacks) corrupts the transport and causes
// "invalid JSON" errors in Claude Desktop. Redirect all console output to stderr.
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
console.warn = (...args: unknown[]) => console.error(...args)
console.debug = (...args: unknown[]) => console.error(...args)

// The Relay SDK fires background status-polling requests that aren't connected
// to the main promise chain. When a poll fails (e.g. "Transaction receipt not
// found" — a transient 500 from the Relay API), it becomes an unhandled
// rejection that would crash the process and kill the MCP server. Catch these
// so the server stays alive and the tool call can still complete or fail
// gracefully through the normal error path.
process.on('unhandledRejection', (reason) => {
  console.error('[MCP] Unhandled rejection (kept alive):', reason)
})

async function main() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
