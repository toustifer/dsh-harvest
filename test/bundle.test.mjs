import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'

test('standalone plugin starts outside repository with no node_modules',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'harvest-bundle-中文 '))
  const dest=path.join(root,'dsh-harvest')
  await fs.cp(fileURLToPath(new URL('../dist/dsh-harvest',import.meta.url)),dest,{recursive:true})
  const config=JSON.parse(await fs.readFile(path.join(dest,'.mcp.json'),'utf8')).mcpServers.harvest
  const client=new Client({name:'bundle-test',version:'1.0.0'})
  t.after(async()=>{
    await client.close()
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('harvest-bundle-'))
    await fs.rm(root,{recursive:true,force:true})
  })
  const transport=new StdioClientTransport({command:process.execPath,args:config.args,cwd:path.resolve(dest,config.cwd),stderr:'pipe'})
  await client.connect(transport)
  assert.equal((await client.listTools()).tools.length,7)
  const r=await client.callTool({name:'harvest_audit',arguments:{sources:[{title:'sample'}]}})
  assert.equal(r.structuredContent.matrix[0].verdict,'needs_review')
})
