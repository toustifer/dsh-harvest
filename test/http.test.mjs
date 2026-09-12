import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { httpGetText, requestJson } from '../lib/core/http.js'

test('HTTP status preservation, body bound, redirect refusal and deadline',async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/slow') return
    if(req.url==='/large') {res.writeHead(200,{'Content-Length':3000000});res.end();return}
    if(req.url==='/redirect') {res.writeHead(302,{Location:'/ok'});res.end();return}
    res.writeHead(req.url==='/paywall' ? 402 : 200,{'Content-Type':'application/json'})
    res.end('{"ok":true}')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  const base=`http://127.0.0.1:${server.address().port}`
  assert.equal((await httpGetText(base+'/paywall')).status,402)
  assert.deepEqual(await requestJson(base+'/ok'),{ok:true})
  await assert.rejects(httpGetText(base+'/large'),/2 MiB/)
  await assert.rejects(requestJson(base+'/redirect'))
  const started=Date.now()
  await assert.rejects(httpGetText(base+'/slow',{timeoutMs:50}))
  assert.ok(Date.now()-started<2000)
})
