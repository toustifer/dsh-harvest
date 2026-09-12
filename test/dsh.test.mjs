// DSH 适配器契约测试（C）：钉住真实踩过的坑，避免静默回归。
//   1) exec.signal 必须透传（曾经被 execute:args=>tool.execute(args) 吞掉）
//   2) 带 .default() 的字段不得出现在 required（zod 默认 io=output 的投影坑）
//   3) 8 个工具集合、output 契约、render 纯度
//   4) web Provider 形状 + $DSH_HOME 凭据解析
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply, name, inject } from '../lib/adapters/dsh/index.js'

const EXPECTED_TOOLS = ['harvest_doctor','harvest_scout','harvest_extract','harvest_verify','harvest_audit',
  'harvest_research_start','harvest_research_status','harvest_deep_research']

// 取消验证用的最小合法参数（都必须在任何网络/磁盘动作之前就被信号拦下）。
const MINIMAL_ARGS = {
  harvest_doctor:{}, harvest_scout:{query:'cancel probe'}, harvest_extract:{urls:['https://example.com']},
  harvest_verify:{claims:['cancel probe']}, harvest_audit:{sources:[]},
  harvest_research_start:{input:'cancel probe'}, harvest_research_status:{request_id:'cancel probe'},
  harvest_deep_research:{input:'cancel probe'},
}

// 模拟 DSH 严格 register：重名即抛，并收集 web Provider。
function register() {
  const defs = new Map()
  const providers = []
  const ctx = {
    tools: { register(definition) {
      assert.ok(!defs.has(definition.name), `重复注册工具：${definition.name}`)
      defs.set(definition.name,definition)
      return () => {}
    } },
    inject(deps,callback) {
      assert.ok(deps.includes('web'), 'DSH 适配器应按需注入 web')
      callback({ web: { registerSearchProvider(provider) { providers.push(provider); return () => {} } } })
    },
  }
  apply(ctx)
  return { defs, providers }
}

test('DSH adapter exposes the plugin surface and the fixed tool set', () => {
  assert.equal(name,'harvest')
  assert.ok(inject.includes('tools'))
  const { defs, providers } = register()
  assert.deepEqual([...defs.keys()],EXPECTED_TOOLS)
  assert.equal(providers.length,1)
})

test('every registered tool satisfies the DSH output contract', () => {
  const { defs } = register()
  for (const [tool,definition] of defs) {
    assert.equal(definition.output.schema.type,'object',`${tool} 的 output.schema 必须对象根`)
    assert.equal(typeof definition.output.render,'function',`${tool} 缺少 output.render`)
    assert.equal(typeof definition.execute,'function',`${tool} 缺少 execute`)
    assert.ok(definition.execute.length >= 2,`${tool}.execute 必须声明 (args, exec) 才能收到 exec.signal`)
    assert.equal(typeof definition.parameters?.type,'string')
    const value = { tool, ok:true, nested:{ list:[1,2,3] } }
    const before = JSON.stringify(value)
    const first = definition.output.render({ any:'args' },value)
    const second = definition.output.render({ other:'args' },value)
    assert.ok(Array.isArray(first) && first.every(block => block.type === 'text' && typeof block.text === 'string'),
      `${tool} 的 render 必须返回 ContentBlock[]`)
    assert.deepEqual(first,second,`${tool} 的 render 必须是纯函数`)
    assert.equal(JSON.stringify(value),before,`${tool} 的 render 不得改动 canonical value`)
  }
})

test('model-facing schemas describe input: defaulted fields are never required', () => {
  const { defs } = register()
  const defaulted = []
  for (const [tool,definition] of defs) {
    const { parameters } = definition
    assert.equal(parameters.type,'object',`${tool} 的 parameters 必须对象根`)
    assert.ok(!Object.hasOwn(parameters,'$schema'),`${tool} 的 parameters 不应带 $schema 噪声键`)
    const properties = parameters.properties || {}
    const required = parameters.required || []
    for (const key of required) assert.ok(Object.hasOwn(properties,key),`${tool}.${key} 在 required 中但未声明`)
    for (const [key,spec] of Object.entries(properties)) {
      if (spec && Object.hasOwn(spec,'default')) {
        defaulted.push(`${tool}.${key}`)
        assert.ok(!required.includes(key),
          `${tool}.${key} 带 default 就不该是必填（zod toJSONSchema 默认 io=output 的投影坑）`)
      }
    }
  }
  // 防止断言空转：核心工具确实有多个默认值参数。
  assert.ok(defaulted.length >= 5,`带默认值的参数应有多个，实际 ${defaulted.length}；本断言可能已失效`)
})

test('every tool observes the DSH exec cancellation signal', async () => {
  const { defs } = register()
  const controller = new AbortController()
  controller.abort()
  for (const [tool,args] of Object.entries(MINIMAL_ARGS)) {
    await assert.rejects(defs.get(tool).execute(args,{ signal:controller.signal }),
      error => error?.name === 'AbortError',
      `${tool} 丢弃了 exec.signal：已 abort 的调用必须立即以 AbortError 终止`)
  }
})

test('harvest_deep_research surfaces caller cancellation instead of credential errors', async () => {
  const { defs } = register()
  const controller = new AbortController()
  controller.abort()
  // 无凭据时该工具本会抛「not configured」；取消必须优先，且不得发起任何提交。
  await assert.rejects(defs.get('harvest_deep_research').execute({ input:'cancel probe', pollIntervalMs:1000, timeoutMs:1000 },
    { signal:controller.signal }), error => error?.name === 'AbortError')
})

test('web provider follows the DSH seam and resolves credentials from $DSH_HOME', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'harvest-dsh-home-'))
  const savedHome = process.env.DSH_HOME
  const savedKey = process.env.TAVILY_API_KEY
  t.after(async () => {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome
    if (savedKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = savedKey
    await fs.rm(home,{ recursive:true, force:true })
  })
  delete process.env.TAVILY_API_KEY
  process.env.DSH_HOME = home

  const withoutKey = register()
  const provider = withoutKey.providers[0]
  assert.equal(provider.id,'tavily')
  assert.equal(typeof provider.search,'function')
  assert.ok(provider.search.length >= 1,'search(request, signal) 必须能接收取消信号')
  assert.equal(provider.available(),false,'无凭据时 available() 必须为 false 且不得联网')

  await fs.writeFile(path.join(home,'.credentials.yaml'),'refs:\n  TAVILY_API_KEY: dsh-home-probe-key\n')
  const withKey = register()
  assert.equal(withKey.providers[0].available(),true,'凭据应通过 $DSH_HOME/.credentials.yaml 解析到')
})

test('DSH_HARVEST_TRACE gates the boot trace on stderr', async t => {
  const savedTrace = process.env.DSH_HARVEST_TRACE
  const written = []
  const original = process.stderr.write
  process.stderr.write = chunk => { written.push(String(chunk)); return true }
  t.after(() => {
    process.stderr.write = original
    if (savedTrace === undefined) delete process.env.DSH_HARVEST_TRACE
    else process.env.DSH_HARVEST_TRACE = savedTrace
  })

  delete process.env.DSH_HARVEST_TRACE
  register()
  assert.deepEqual(written,[],'未开启埋点时不得写 stderr')

  process.env.DSH_HARVEST_TRACE = '1'
  register()
  assert.match(written.join(''),/registered 8 tools/,   '开启后应打印已注册工具数')
  assert.match(written.join(''),/web search provider/,'开启后应打印 Provider 状态')
})
