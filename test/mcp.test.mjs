import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { apply } from '../lib/index.js'

test('real stdio client initializes, discovers tools, calls and validates',async t=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/harvest-mcp.mjs',import.meta.url))],stderr:'pipe'})
  const client=new Client({name:'harvest-test',version:'1.0.0'})
  t.after(()=>client.close())
  const start=Date.now()
  await client.connect(transport)
  assert.ok(Date.now()-start<10000,'startup should not probe Python/bash')
  const {tools}=await client.listTools()
  assert.equal(tools.length,7)
  const result=await client.callTool({name:'harvest_verify',arguments:{claims:['Alpha offline'],sources:[]}})
  assert.equal(result.structuredContent.verdicts[0].status,'insufficient_evidence')
  const invalid=await client.callTool({name:'harvest_scout',arguments:{query:'test',limit:1.5}})
  assert.equal(invalid.isError,true)
})
test('DSH registration contract still works without a web context',()=>{
  const tools=[]
  apply({tools:{register:t=>tools.push(t)}})
  assert.ok(tools.some(t=>t.name==='harvest_deep_research'))
  assert.ok(tools.every(t=>t.parameters.type==='object'))
})
