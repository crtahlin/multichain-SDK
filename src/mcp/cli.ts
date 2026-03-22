#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server.js'

// MCP uses stdout for JSON-RPC transport. Any console.log from dependencies
// (e.g. Relay SDK progress callbacks) corrupts the transport and causes
// "invalid JSON" errors in Claude Desktop. Redirect all console output to stderr.
const originalLog = console.log
const originalInfo = console.info
const originalWarn = console.warn
const originalDebug = console.debug
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)
console.warn = (...args: unknown[]) => console.error(...args)
console.debug = (...args: unknown[]) => console.error(...args)

async function main() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
