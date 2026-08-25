import { name, inject, apply } from '../lib/index.js'
import { BACKENDS } from '../lib/backends.js'
import { extractOne } from '../lib/extract.js'
import { httpGetText } from '../lib/http.js'

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
}

assert(name === 'harvest', `name 应为 harvest，实为 ${name}`)
assert(Array.isArray(inject) && inject.includes('tools'), 'inject 应包含 tools')
assert(typeof apply === 'function', 'apply 应为函数')
assert(Object.keys(BACKENDS).length === 9, `应有 9 个后端，实为 ${Object.keys(BACKENDS).length}`)
assert(typeof extractOne === 'function', 'extractOne 应为函数')
assert(typeof httpGetText === 'function', 'httpGetText 应为函数')

console.log('smoke OK: dsh-harvest 插件可加载，9 通道后端，抓取/HTTP 模块就绪')
