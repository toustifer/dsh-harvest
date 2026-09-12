// Legacy smoke entry; deterministic and network-free. Full suite: npm test.
import assert from 'node:assert/strict'
import {apply,name,inject} from '../lib/index.js'
const tools=[]
apply({tools:{register:tool=>tools.push(tool)}})
assert.equal(name,'harvest')
assert.ok(inject.includes('tools'))
assert.equal(tools.length,8)
console.log('DSH adapter smoke OK (8 tools)')
