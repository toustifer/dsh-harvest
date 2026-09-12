#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from '../lib/mcp.js'

const server = createServer()
await server.connect(new StdioServerTransport())
