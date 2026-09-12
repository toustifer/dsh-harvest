#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from '../lib/adapters/mcp/server.js'

const server = createServer()
await server.connect(new StdioServerTransport())
