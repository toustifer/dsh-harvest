import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createResearch } from '../lib/core/research.js'

async function fixture(t) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'harvest-test-'))
  t.after(async()=>{ // Only remove the exact newly-created test directory.
    assert.equal(path.dirname(dataDir),os.tmpdir())
    assert.ok(path.basename(dataDir).startsWith('harvest-test-'))
    await fs.rm(dataDir,{recursive:true,force:true})
  })
  return {key:'test-secret',dataDir,researchEndpoint:'https://api.tavily.com/research'}
}
test('research resumes across instances, caches completed report and paginates',async t=>{
  const config=await fixture(t)
  let calls=0
  const request=async (_url,options)=>{
    calls++
    return options.method==='POST' ? {request_id:'task-1',status:'pending'} : {status:'completed',content:'abc'.repeat(1000),sources:[]}
  }
  const start=await createResearch(config,request).start({input:'topic'})
  assert.equal(start.request_id,'task-1')
  const result=await createResearch(config,request).status({request_id:start.request_id,maxChars:500})
  assert.equal(result.status,'completed');assert.equal(result.content.length,500);assert.equal(result.nextOffset,500)
  const cached=await createResearch({...config,key:undefined},()=>{throw new Error('network must not be used')}).status({request_id:'task-1',offset:500,maxChars:500})
  assert.equal(cached.offset,500);assert.equal(calls,2)
  const filenames=await fs.readdir(path.join(config.dataDir,'tasks'))
  const disk=await fs.readFile(path.join(config.dataDir,'tasks',filenames[0]),'utf8')
  assert.ok(!disk.includes('test-secret'))
})
test('missing credential blocks submission; failed POST is never retried',async t=>{
  const config=await fixture(t)
  let calls=0
  const request=async()=>{calls++;throw new Error('timeout')}
  await assert.rejects(createResearch({...config,key:undefined},request).start({input:'topic'}),/not configured/)
  assert.equal(calls,0)
  await assert.rejects(createResearch(config,request).start({input:'topic'}),/Do not automatically resubmit/)
  assert.equal(calls,1)
})
test('saved endpoint cannot be silently changed',async t=>{
  const config=await fixture(t)
  await createResearch(config,async()=>({request_id:'one',status:'pending'})).start({input:'topic'})
  await assert.rejects(createResearch({...config,researchEndpoint:'https://different.example/research'}).status({request_id:'one'}),/differs/)
})
