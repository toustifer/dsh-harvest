// ============================================================================
// dsh-harvest smoke —— 加载契约 + 执行层平台契约（T-03，审计 BLOK-3 验证闭环）
// 零依赖（Node ≥18，.mjs 顶层 await）。
//
// 目标形态：fix-shell-layer 落地后的平台分支（审计 4.1）——
//   非 win32：build() 返回 argv 直调（{ file, args }），不再出现 powershell.exe / .ps1；
//   win32   ：保留 PS 垫片形态，但 SHIM_DIR 由 os.homedir() 派生，不再含硬编码用户名。
// 若 fix-shell-layer 尚未提交（本机/CI 跑在 pre-fix lib 上），平台探测断言会红——
// 这是预期的回归绊线：随 fix-shell-layer 提交转绿。不要改 lib/ 来迁就本断言。
// ============================================================================
import os from 'node:os'
import path from 'node:path'
import { name, inject, apply, sanitizeResearchInput } from '../lib/index.js'
import { BACKENDS, scoutChannel } from '../lib/backends.js'
import { extractOne, decodeBuffer } from '../lib/extract.js'
import { httpGetText } from '../lib/http.js'

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
}

const IS_WIN = process.platform === 'win32'

// —— 加载契约（严格 11 通道契约断言 + 模块函数存在性）——
assert(name === 'harvest', `name 应为 harvest，实为 ${name}`)
assert(Array.isArray(inject) && inject.includes('tools'), 'inject 应包含 tools')
assert(typeof apply === 'function', 'apply 应为函数')

// 严格断言 11 通道总数与枚举契约（包含 telegram 与 linuxdo）
const EXPECTED_CHANNELS = [
  'github', 'web', 'twitter', 'reddit', 'xiaohongshu',
  'youtube', 'bilibili', 'v2ex', 'linkedin', 'telegram', 'linuxdo'
]
assert(
  Object.keys(BACKENDS).length === 11,
  `BACKENDS 通道总数应严格为 11，实为 ${Object.keys(BACKENDS).length}`
)
for (const ch of EXPECTED_CHANNELS) {
  assert(Boolean(BACKENDS[ch]), `BACKENDS 应包含通道 ${ch}`)
}

assert(typeof extractOne === 'function', 'extractOne 应为函数')
assert(typeof httpGetText === 'function', 'httpGetText 应为函数')

// 验证 apply 注册 skills 与 tools
let registeredSkill = null
const registeredTools = []
const mockCtx = {
  logger: () => console,
  tools: { register: (t) => registeredTools.push(t) },
  inject: (deps, fn) => {
    if (deps.includes('skills')) {
      fn({
        skills: {
          register: (s) => { registeredSkill = s },
        },
      })
    }
  },
}
apply(mockCtx)
assert(registeredSkill && registeredSkill.name === 'harvest', 'apply 应向 ctx.skills 注册 harvest skill')
assert(typeof registeredSkill.source === 'string' && registeredSkill.source.length > 0, 'registeredSkill.source 必须是非空 string')
assert(typeof registeredSkill.content === 'string' && registeredSkill.content.length > 0, 'registeredSkill.content 必须是非空 string')
assert(registeredTools.length >= 5, `apply 应注册至少 5 个工具，实为 ${registeredTools.length}`)

// —— T-03-1 平台探测断言（审计 BLOK-1/BLOK-2：Windows 独占假定不得回归）——
// 11 通道中除 v2ex (fetchUrl) 外，其余 10 个通道均提供 build()
const buildChannels = Object.keys(BACKENDS).filter((id) => typeof BACKENDS[id].build === 'function')
assert(buildChannels.length === 10, `应有恰好 10 个通道具备 build()，实为 ${buildChannels.length}`)

// argv 直调契约（审计 4.1/4.4：进程调用走 { file, args }，不拼 shell 字符串）
for (const id of buildChannels) {
  const b = BACKENDS[id].build('smoke platform probe', 1)
  assert(typeof b.file === 'string' && b.file.length > 0, `${id} build() 应返回 { file: string }`)
  assert(Array.isArray(b.args) && b.args.every((a) => typeof a === 'string'), `${id} build() args 应为 string[]（argv 直调契约）`)
}

const dump = (id) => JSON.stringify(BACKENDS[id].build('smoke platform probe', 1))
if (IS_WIN) {
  // win32：允许保留 PS 垫片（审计 4.1），SHIM_DIR 由 os.homedir() / DSH_HARVEST_BIN 派生（BLOK-2）
  // 检验 dump(id) 中使用 .ps1 垫片的通道是否正确包含派生的路径结构，避免直接字面匹配特定用户名导致假阳性误报
  const expectedShimDir = process.env.DSH_HARVEST_BIN || path.join(os.homedir(), '.npm-global')
  const jsonShimDir = JSON.stringify(expectedShimDir).slice(1, -1)
  const shimChannels = buildChannels.filter((id) => dump(id).includes('.ps1'))
  assert(shimChannels.length > 0, 'win32 下应有通道使用 .ps1 垫片')
  const invalidShimChannels = shimChannels.filter((id) => !dump(id).includes(jsonShimDir))
  assert(invalidShimChannels.length === 0, `win32 下 build() 垫片路径未包含派生自 os.homedir() 的目录: ${invalidShimChannels.join(',')}`)
} else {
  // 非 win32：任何通道 build() 不得再引用 powershell(.exe) / .ps1 垫片（BLOK-1）
  const leaked = buildChannels.filter((id) => /powershell(\.exe)?|\.ps1/i.test(dump(id)))
  assert(leaked.length === 0, `非 win32 下 build() 仍引用 Windows 垫片(powershell/.ps1): ${leaked.join(',')}（目标形态=审计 4.1 argv 直调；若 fix-shell-layer 未提交，此为预期红，随其提交转绿）`)
}

// —— T-03-2 「无 CLI / 未配置环境冒烟」：优雅跳过契约（审计 T-03 / 4.4）——
// 与 harvest_scout 相同的 Promise.all + 逐通道 try/catch 聚合语义：任一通道失败
// （CLI 缺失 ENOENT / 鉴权未配置 / 会话过期 / 空结果 / 未知通道）→ 记 skipped，聚合整体不抛。
// 探测集覆盖公开 CLI、深度情报通道与注入的未知通道：
// - github（CI runner 无认证 gh → 空结果进 skipped；本机装有 gh 则执行）
// - youtube/bilibili（CI runner 无 yt-dlp/bili → ENOENT 进 skipped）
// - telegram/linuxdo（未授权或无依赖时抛错进 skipped，已授权时返回数据）
// - __definitely_missing_channel__（未知通道确定性进入 skipped）
const PROBE = ['github', 'youtube', 'bilibili', 'telegram', 'linuxdo', '__definitely_missing_channel__']
const aggregateAction = () => Promise.all(PROBE.map(async (id) => {
  try {
    const items = await scoutChannel(id, 'smoke ci matrix probe', 1)
    return { ok: true, id, items }
  } catch (e) {
    return { ok: false, id, reason: String(e?.message ?? e) }
  }
}))
let results = null
let aggregateError = null
try {
  results = await aggregateAction()
} catch (e) {
  aggregateError = e
}
assert(aggregateError === null, `聚合层（Promise.all + 逐通道 try/catch）整体不应抛，实为 ${String(aggregateError)}`)
assert(Array.isArray(results) && results.length === PROBE.length, '聚合结果数应为探测通道数')
assert(results.every((r) => typeof r.ok === 'boolean'), '每个探测通道结果应带 ok 标记')
for (const r of results) {
  if (r.ok) {
    assert(Array.isArray(r.items), `${r.id} 成功时 items 应为数组`)
  } else {
    assert(typeof r.reason === 'string' && r.reason.length > 0, `${r.id} 失败时应包含非空 reason`)
  }
}
const skipped = results.filter((r) => !r.ok)
assert(skipped.some((s) => /unknown platform/.test(s.reason)), '注入的未知通道必须进入 skipped（优雅跳过契约）')

// —— T-03-3 鲁棒性改进断言（scout 模糊映射 + 编码修复）——
// 1. scout 模糊映射：测试 scoutChannel('zhihu', 'test', 1) 在 CI/无 CLI 环境下：
// 既不应抛出未知平台错误（schema/unknown platform），若底层 web CLI 缺失则优雅跳过（抛 ENOENT/CLI 缺失等），均不作为硬崩溃。
try {
  const zhihuResults = await scoutChannel('zhihu', 'test', 1)
  assert(Array.isArray(zhihuResults), 'scoutChannel("zhihu", ...) 成功时应返回数组')
} catch (e) {
  // 在 CI 环境下没有安装 mcporter/tavily key，应当进入正常的底层执行失败（如 ENOENT），而决不能是 unknown platform 错误
  assert(!/unknown platform/i.test(e?.message ?? ''), `scoutChannel('zhihu', ...) 不应被判定为 unknown platform: ${e?.message ?? e}`)
}

// 2. 编码修复（伪造测试）：创建一个简单的 GBK 编码数据 Buffer，调用 decodeBuffer 验证解码后字符正确
// GBK 编码: "中文测试" -> 0xD6 0xD0 0xCE 0xC4 0xB2 0xE2 0xCA 0xD4
const gbkHtml = Buffer.concat([
  Buffer.from('<html><head><meta charset="gbk"></head><body>'),
  Buffer.from([0xD6, 0xD0, 0xCE, 0xC4, 0xB2, 0xE2, 0xCA, 0xD4]),
  Buffer.from('</body></html>')
])
const decodedText = decodeBuffer(gbkHtml)
assert(decodedText.includes('中文测试'), `GBK 解码后应包含 "中文测试"，实为: ${decodedText}`)

// —— T-03-4 深度调研输入净化断言（sanitizeResearchInput 风控敏感词规避）——
assert(typeof sanitizeResearchInput === 'function', 'sanitizeResearchInput 应为函数')
// 1. 中文敏感词替换
assert(
  sanitizeResearchInput('如何绕过 Google 验证') === '如何解决 Google 验证',
  '包含敏感词“绕过”应被转换为“解决”'
)
assert(
  sanitizeResearchInput('破解账号池') === '排查多账号池',
  '敏感词“破解”与“账号池”应被正确替换为“排查”与“多账号池”'
)

// 2. 英文单词界限匹配
assert(
  sanitizeResearchInput('How to bypass auth and crack account') === 'How to resolve auth and debug account',
  '英文敏感词 bypass 与 crack 应在单词边界处替换为 resolve 与 debug'
)
assert(
  sanitizeResearchInput('crackdown bypasser') === 'crackdown bypasser',
  '英文单词边界匹配不应误伤包含子串的正常词汇（如 crackdown/bypasser）'
)

// 3. 普通词汇不受影响
assert(
  sanitizeResearchInput('量子计算最新进展研究') === '量子计算最新进展研究',
  '普通词汇不应受影响'
)
assert(
  sanitizeResearchInput('deep research on LLM agents') === 'deep research on LLM agents',
  '英文普通词汇不应受影响'
)

// 4. 非字符串输入安全返回
assert(sanitizeResearchInput(null) === null, '非字符串 null 应安全返回')
assert(sanitizeResearchInput(undefined) === undefined, '非字符串 undefined 应安全返回')
assert(sanitizeResearchInput(12345) === 12345, '非字符串数字应安全返回')
const mockObj = { query: 'test' }
assert(sanitizeResearchInput(mockObj) === mockObj, '非字符串对象应原样安全返回')

// —— T-03-5 深度情报通道契约与边界断言（telegram & linuxdo）——
// 1. 结构与方法完整性
assert(typeof BACKENDS.telegram === 'object', 'BACKENDS 应包含 telegram')
assert(typeof BACKENDS.telegram.probe === 'function', 'telegram 应包含 probe()')
assert(typeof BACKENDS.telegram.build === 'function', 'telegram 应包含 build()')
assert(typeof BACKENDS.telegram.parse === 'function', 'telegram 应包含 parse()')

assert(typeof BACKENDS.linuxdo === 'object', 'BACKENDS 应包含 linuxdo')
assert(typeof BACKENDS.linuxdo.probe === 'function', 'linuxdo 应包含 probe()')
assert(typeof BACKENDS.linuxdo.build === 'function', 'linuxdo 应包含 build()')
assert(typeof BACKENDS.linuxdo.parse === 'function', 'linuxdo 应包含 parse()')

// 2. probe() 契约：返回布尔值，不抛异常
const tgProbe = BACKENDS.telegram.probe()
assert(typeof tgProbe === 'boolean', `telegram.probe() 应返回 boolean，实为 ${typeof tgProbe}`)
const ldoProbe = BACKENDS.linuxdo.probe()
assert(typeof ldoProbe === 'boolean', `linuxdo.probe() 应返回 boolean，实为 ${typeof ldoProbe}`)

// 3. build() 参数映射与边界
const sampleTgBuild = BACKENDS.telegram.build('deepseek reasoning', 5)
assert(typeof sampleTgBuild.file === 'string' && sampleTgBuild.file.length > 0, 'telegram build() 返回 file 应为非空字符串')
assert(Array.isArray(sampleTgBuild.args), 'telegram build() 返回 args 应为数组')
assert(sampleTgBuild.args.includes('-c'), 'telegram build() args 应包含 -c 参数')
assert(sampleTgBuild.args.includes('deepseek reasoning'), 'telegram build() args 应包含 query')
assert(sampleTgBuild.args.includes('5'), 'telegram build() args 应包含 limit 字符串')

const sampleLdoBuild = BACKENDS.linuxdo.build('linuxdo architecture', 8)
assert(typeof sampleLdoBuild.file === 'string' && sampleLdoBuild.file.length > 0, 'linuxdo build() 返回 file 应为非空字符串')
assert(Array.isArray(sampleLdoBuild.args), 'linuxdo build() 返回 args 应为数组')
assert(sampleLdoBuild.args.includes('-c'), 'linuxdo build() args 应包含 -c 参数')
assert(sampleLdoBuild.args.includes('linuxdo architecture'), 'linuxdo build() args 应包含 query')
assert(sampleLdoBuild.args.includes('8'), 'linuxdo build() args 应包含 limit 字符串')

// 4. parse() 归一化字段映射与防御性边界断言
// (1) telegram 字段映射
const sampleTgParsed = BACKENDS.telegram.parse(JSON.stringify([{
  title: 'Alice: Hello world',
  url: 'https://t.me/c/123/456',
  snippet: 'Hello world full message',
}]), 'telegram')
assert(Array.isArray(sampleTgParsed) && sampleTgParsed.length === 1, 'telegram parse 应正确输出数组')
assert(sampleTgParsed[0].platform === 'telegram', 'telegram parse 结果应保留 platform')
assert(sampleTgParsed[0].title === 'Alice: Hello world', 'telegram parse 结果应保留 title')
assert(sampleTgParsed[0].url === 'https://t.me/c/123/456', 'telegram parse 结果应保留 url')
assert(sampleTgParsed[0].note === 'Hello world full message', 'telegram parse 结果 snippet 应映射为 note')

// telegram 包装格式兼容 ({ data: [...] })
const sampleTgWrapped = BACKENDS.telegram.parse(JSON.stringify({
  data: [{ title: 'Bob: Wrapped Msg', url: 'https://t.me/c/789/101', snippet: 'wrapped note' }]
}), 'telegram')
assert(Array.isArray(sampleTgWrapped) && sampleTgWrapped.length === 1, 'telegram parse 应支持 { data: [...] } 包装格式')
assert(sampleTgWrapped[0].title === 'Bob: Wrapped Msg', '包装条目 title 正确解构')

// (2) linuxdo 字段映射
const sampleLdoParsed = BACKENDS.linuxdo.parse(JSON.stringify([{
  title: 'Test Topic',
  url: 'https://linux.do/t/12345',
  snippet: 'Test snippet content',
}]), 'linuxdo')
assert(Array.isArray(sampleLdoParsed) && sampleLdoParsed.length === 1, 'linuxdo parse 应正确输出数组')
assert(sampleLdoParsed[0].platform === 'linuxdo', 'linuxdo parse 结果应保留 platform')
assert(sampleLdoParsed[0].title === 'Test Topic', 'linuxdo parse 结果应保留 title')
assert(sampleLdoParsed[0].url === 'https://linux.do/t/12345', 'linuxdo parse 结果应保留 url')
assert(sampleLdoParsed[0].note === 'Test snippet content', 'linuxdo parse 结果 snippet 应映射为 note')

// linuxdo 包装格式兼容 ({ results: [...] })
const sampleLdoWrapped = BACKENDS.linuxdo.parse(JSON.stringify({
  results: [{ title: 'Discourse Topic', url: 'https://linux.do/t/999', snippet: 'blurb note' }]
}), 'linuxdo')
assert(Array.isArray(sampleLdoWrapped) && sampleLdoWrapped.length === 1, 'linuxdo parse 应支持 { results: [...] } 包装格式')
assert(sampleLdoWrapped[0].note === 'blurb note', '包装条目 snippet 正确映射为 note')

// (3) parse() 容错与防御性边界测试（空串、非 JSON、空对象、无有效 title/url）
for (const ch of ['telegram', 'linuxdo']) {
  assert(BACKENDS[ch].parse('', ch).length === 0, `${ch} parse 空串应返回空数组`)
  assert(BACKENDS[ch].parse('invalid json text', ch).length === 0, `${ch} parse 非 JSON 文本应返回空数组`)
  assert(BACKENDS[ch].parse('{}', ch).length === 0, `${ch} parse 空对象应返回空数组`)
  assert(BACKENDS[ch].parse('[]', ch).length === 0, `${ch} parse 空数组应返回空数组`)
  assert(BACKENDS[ch].parse(JSON.stringify([{ foo: 'bar' }]), ch).length === 0, `${ch} parse 无有效 title/url 应过滤排除`)
}

console.log(`smoke OK: dsh-harvest 可加载（${Object.keys(BACKENDS).length} 通道全量合规），平台=${process.platform}，${buildChannels.length} 通道 build() 平台契约成立，优雅跳过契约成立（${skipped.length}/${PROBE.length} 探测通道记 skipped），鲁棒性断言、深度情报通道契约与输入净化单元断言全绿`)
