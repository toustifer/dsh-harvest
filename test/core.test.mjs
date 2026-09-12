import test from 'node:test'
import assert from 'node:assert/strict'
import { createTools } from '../lib/core.js'
import { collectEvidence, auditSources } from '../lib/evidence.js'
import { extractOne } from '../lib/extract.js'
import { BACKENDS } from '../lib/backends.js'
import { getConfig } from '../lib/config.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('contradictory passages are candidates, never verified; URL variants deduplicate', () => {
  const sources = [
    {title:'Alpha',url:'https://example.com/a',text:'Alpha does not support offline mode.'},
    {title:'Copy',url:'https://example.com/a?utm_source=feed#section',text:'Alpha does not support offline mode.'},
    {title:'Beta',url:'https://example.org/b',text:'Alpha requires internet access.'},
  ]
  const result = collectEvidence(['Alpha supports offline mode'], sources)
  assert.equal(result.verdicts[0].status,'needs_review')
  assert.equal(result.verdicts[0].candidates.length,2)
  assert.equal(result.excluded,1)
  assert.equal(result.requiresSemanticReview,true)
})
test('titles alone and missing URLs cannot establish evidence', () => {
  const r = collectEvidence(['Alpha supports offline mode'],[{title:'Alpha offline',url:'https://example.com'},{title:'Alpha',text:'Alpha supports offline mode'}])
  assert.equal(r.verdicts[0].status,'insufficient_evidence')
})
test('audit does not infer credibility or freshness from a URL/type', () => {
  const r = auditSources([{title:'Official',url:'https://example.com/docs.gov',type:'official'}]).matrix[0]
  assert.equal(r.authority,'unknown'); assert.equal(r.publishedAt,null); assert.equal(r.verdict,'needs_review')
})
test('strict bounds reject unsafe or silently truncated inputs', async () => {
  const tools = createTools()
  const call = (name,args) => tools.find(t=>t.name===name).execute(args)
  for (const limit of [0,1.5,-2,Infinity,100]) await assert.rejects(call('harvest_scout',{query:'test',limit}))
  await assert.rejects(call('harvest_scout',{query:'test',surprise:true}))
  await assert.rejects(call('harvest_extract',{urls:['file:///etc/passwd']}))
  await assert.rejects(call('harvest_extract',{urls:Array(4).fill('https://example.com')}))
})
test('channel failure stays isolated; empty and skipped remain distinct', async () => {
  const tool = createTools({scout:async id => {
    if(id==='github') throw new Error('missing CLI')
    return []
  }}).find(t=>t.name==='harvest_scout')
  const r=await tool.execute({query:'x',platforms:['github','web']})
  assert.equal(r.skipped.length,1)
  assert.equal(r.channels.find(c=>c.platform==='web').status,'empty')
})
test('V2EX unrelated hot posts do not become search results', () => {
  assert.deepEqual(BACKENDS.v2ex.parse(JSON.stringify([{title:'Lunch',url:'https://v2ex.com/t/1'}]),'v2ex','quantum physics',5),[])
})
test('malformed channel responses fail instead of masquerading as empty search', () => {
  assert.throws(()=>BACKENDS.github.parse('CLI login failed','github'),/non-JSON/)
  assert.throws(()=>BACKENDS.github.parse('{"unexpected":true}','github'),/unrecognized/)
  assert.deepEqual(BACKENDS.github.parse('[]','github'),[])
})
test('configuration can be isolated without DSH files', () => {
  const r=getConfig({key:'test-key'},{})
  assert.equal(r.key,'test-key'); assert.equal(r.endpoint,'https://api.tavily.com/search')
})
test('empty or script-only HTML upgrades to reader and reports truncation', async () => {
  const calls=[]
  const r=await extractOne('https://example.com','auto',{maxChars:500,get:async url=>{
    calls.push(url)
    return {status:200,text:calls.length===1 ? '<html><script>run()</script></html>' : 'Evidence '.repeat(100)}
  }})
  assert.equal(calls.length,2); assert.equal(r.method,'jina'); assert.equal(r.truncated,true)
  assert.equal(r.text.length,500); assert.equal(r.textLength,900)
})
test('402 does not retry; cancellation does not fallback', async () => {
  let calls=0
  const r=await extractOne('https://example.com','auto',{get:async()=>{calls++;return {status:402,text:''}}})
  assert.equal(r.status,'paywalled'); assert.equal(calls,1)
  const controller=new AbortController(); controller.abort()
  const cancelled=await extractOne('https://example.com','auto',{signal:controller.signal,get:async(_,o)=>{o.signal.throwIfAborted()}})
  assert.equal(cancelled.status,'cancelled')
})
test('optional source snapshot contains the complete fetched text', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harvest-source-'))
  t.after(async()=>{
    assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('harvest-source-'))
    await fs.rm(dir,{recursive:true,force:true})
  })
  const body='Long original text. '.repeat(1000)
  const result=await extractOne('https://example.com','auto',{maxChars:500,saveFullText:true,dataDir:dir,get:async()=>({status:200,text:body})})
  const stored=JSON.parse(await fs.readFile(result.artifactPath,'utf8'))
  assert.equal(result.text.length,500);assert.equal(stored.text,body.trim())
})
