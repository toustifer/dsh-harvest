import http from 'node:http'
import { extractOne } from '../lib/extract.js'

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
}

const gbkHtmlBuffer = Buffer.concat([
  Buffer.from('<!DOCTYPE html><html><head><meta charset="gbk"><title>'),
  Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]),
  Buffer.from('</title></head><body><h1>'),
  Buffer.from([0xCE, 0xD2, 0xC3, 0xC7]),
  Buffer.from('</h1></body></html>')
])

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(gbkHtmlBuffer)
})

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const url = 'http://127.0.0.1:' + port

  try {
    const res = await extractOne(url)
    assert(res.status === 'ok', 'status 应为 ok，实为 ' + res.status)
    assert(res.text.includes('中文'), 'text 应包含 中文，实为: ' + res.text)
    assert(res.text.includes('我们'), 'text 应包含 我们，实为: ' + res.text)
    console.log('GBK extraction test passed! Extracted text:', res.text)
  } catch (err) {
    console.error('Test failed:', err)
    process.exit(1)
  } finally {
    server.close()
  }
})
