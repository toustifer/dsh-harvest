// 分层边界测试（B）：把「core 宿主中立 / 适配器各守其 SDK」从口头约定变成机械校验。
// 越界即红，不需要靠 review 记性。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../',import.meta.url))
const HOST_SDKS = ['yaml','cordis','@modelcontextprotocol/sdk']
const rel = file => path.relative(root,file)

async function list(dir) {
  const out=[]
  for (const item of await fs.readdir(dir,{withFileTypes:true})) {
    const full=path.join(dir,item.name)
    if (item.isDirectory()) out.push(...await list(full))
    else if (/\.m?js$/.test(item.name)) out.push(full)
  }
  return out
}
const read = file => fs.readFile(file,'utf8')
const specifiers = text => [
  ...[...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(m=>m[1]),
  ...[...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1]),
  ...[...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map(m=>m[1]),
]
// 归一化到宿主 SDK 名；非宿主依赖（含 node: 内建）返回 null。
const hostSdkOf = spec => {
  for (const sdk of HOST_SDKS) if (spec === sdk || spec.startsWith(`${sdk}/`)) return sdk
  return spec.startsWith('@deepseek-ai/') ? spec : null
}
const fileExists = file => fs.stat(file).then(stat=>stat.isFile()).catch(()=>false)

test('lib/core is host-neutral: no host SDK import', async () => {
  const files = await list(path.join(root,'lib','core'))
  assert.ok(files.length >= 8, `lib/core 应有 8 个模块，实为 ${files.length}`)
  for (const file of files) {
    for (const spec of specifiers(await read(file))) {
      const host = hostSdkOf(spec)
      assert.equal(host, null, `${rel(file)} 是宿主中立层，不得 import 宿主 SDK：${spec}`)
    }
  }
})

test('the DSH adapter may only import yaml + the neutral core', async () => {
  const files = await list(path.join(root,'lib','adapters','dsh'))
  assert.ok(files.length >= 1, '缺少 DSH 适配器')
  for (const file of files) {
    for (const spec of specifiers(await read(file))) {
      const host = hostSdkOf(spec)
      if (!host) continue
      assert.ok(host === 'yaml', `${rel(file)} 只允许 yaml 这一个宿主依赖，不得 import：${spec}`)
    }
    for (const spec of specifiers(await read(file))) {
      assert.ok(!spec.includes('adapters/mcp'), `${rel(file)} 不得依赖另一个适配器：${spec}`)
    }
  }
})

test('the MCP adapter may only import the MCP SDK + the neutral core (no DSH yaml)', async () => {
  const files = await list(path.join(root,'lib','adapters','mcp'))
  assert.ok(files.length >= 1, '缺少 MCP 适配器')
  for (const file of files) {
    for (const spec of specifiers(await read(file))) {
      const host = hostSdkOf(spec)
      if (!host) continue
      assert.ok(host === '@modelcontextprotocol/sdk', `${rel(file)} 只允许 MCP SDK 这一个宿主依赖，不得 import：${spec}`)
    }
    for (const spec of specifiers(await read(file))) {
      assert.ok(!spec.includes('adapters/dsh'), `${rel(file)} 不得依赖另一个适配器：${spec}`)
    }
  }
})

test('every relative import under lib/ and bin/ resolves to a real file', async () => {
  const files = [...await list(path.join(root,'lib')),...await list(path.join(root,'bin'))]
  assert.ok(files.length >= 12, `扫描到的文件偏少（${files.length}），分层可能被破坏`)
  for (const file of files) {
    for (const spec of specifiers(await read(file))) {
      if (!spec.startsWith('.')) continue
      const target = path.resolve(path.dirname(file),spec)
      assert.ok(await fileExists(target), `${rel(file)} 引用了不存在的模块：${spec}`)
    }
  }
})

test('bin entry points stay thin: builtins, lib/, and their own host SDK only', async () => {
  for (const file of await list(path.join(root,'bin'))) {
    for (const spec of specifiers(await read(file))) {
      const ok = spec.startsWith('node:') || spec.startsWith('../lib/') || hostSdkOf(spec) === '@modelcontextprotocol/sdk'
      assert.ok(ok, `${rel(file)} 只应做入口转发，不得 import：${spec}`)
    }
  }
})
