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
import { name, inject, apply } from '../lib/index.js'
import { BACKENDS, scoutChannel } from '../lib/backends.js'
import { extractOne } from '../lib/extract.js'
import { httpGetText } from '../lib/http.js'

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
}

const IS_WIN = process.platform === 'win32'

// —— 加载契约（既有断言：inject/apply/9 通道计数/模块函数存在性，保持不变）——
assert(name === 'harvest', `name 应为 harvest，实为 ${name}`)
assert(Array.isArray(inject) && inject.includes('tools'), 'inject 应包含 tools')
assert(typeof apply === 'function', 'apply 应为函数')
assert(Object.keys(BACKENDS).length === 9, `应有 9 个后端，实为 ${Object.keys(BACKENDS).length}`)
assert(typeof extractOne === 'function', 'extractOne 应为函数')
assert(typeof httpGetText === 'function', 'httpGetText 应为函数')

// —— T-03-1 平台探测断言（审计 BLOK-1/BLOK-2：Windows 独占假定不得回归）——
const buildChannels = Object.keys(BACKENDS).filter((id) => typeof BACKENDS[id].build === 'function')
assert(buildChannels.length >= 8, `应有至少 8 个通道具备 build()，实为 ${buildChannels.length}`)

// argv 直调契约（审计 4.1/4.4：进程调用走 { file, args }，不拼 shell 字符串）
for (const id of buildChannels) {
  const b = BACKENDS[id].build('smoke platform probe', 1)
  assert(typeof b.file === 'string' && b.file.length > 0, `${id} build() 应返回 { file: string }`)
  assert(Array.isArray(b.args) && b.args.every((a) => typeof a === 'string'), `${id} build() args 应为 string[]（argv 直调契约）`)
}

const dump = (id) => JSON.stringify(BACKENDS[id].build('smoke platform probe', 1))
if (IS_WIN) {
  // win32：允许保留 PS 垫片（审计 4.1），但不得再含硬编码用户名 15775（BLOK-2）
  const hardcoded = buildChannels.filter((id) => dump(id).includes('15775'))
  assert(hardcoded.length === 0, `win32 下 build() 仍含硬编码用户名(15775): ${hardcoded.join(',')}（目标形态=SHIM_DIR 由 os.homedir() 派生；随 fix-shell-layer 提交转绿）`)
} else {
  // 非 win32：任何通道 build() 不得再引用 powershell(.exe) / .ps1 垫片（BLOK-1）
  const leaked = buildChannels.filter((id) => /powershell(\.exe)?|\.ps1/i.test(dump(id)))
  assert(leaked.length === 0, `非 win32 下 build() 仍引用 Windows 垫片(powershell/.ps1): ${leaked.join(',')}（目标形态=审计 4.1 argv 直调；若 fix-shell-layer 未提交，此为预期红，随其提交转绿）`)
}

// —— T-03-2 「无 CLI 环境冒烟」：优雅跳过契约（审计 T-03 / 4.4）——
// 与 harvest_scout 相同的 Promise.all + 逐通道 try/catch 聚合语义：任一通道失败
// （CLI 缺失 ENOENT / 空结果 / 未知通道）→ 记 skipped，聚合整体不抛。
// 探测集：github（CI runner 无认证 gh → 失败进 skipped；本机装有 gh 则真实执行=ok）、
// youtube/bilibili（CI runner 无 yt-dlp/bili → ENOENT 进 skipped；注意通道 id 是 bilibili，
// 其 build() 内的二进制名才是 bili）、__definitely_missing_channel__（未知通道，
// 确定性验证 skipped 路径）。
const PROBE = ['github', 'youtube', 'bilibili', '__definitely_missing_channel__']
const aggregateAction = () => Promise.all(PROBE.map(async (id) => {
  try {
    const items = await scoutChannel(id, 'smoke ci matrix probe', 2)
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
const skipped = results.filter((r) => !r.ok)
assert(skipped.some((s) => /unknown platform/.test(s.reason)), '注入的未知通道必须进入 skipped（优雅跳过契约）')
assert(skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 0), 'skipped 条目应携带非空原因')

console.log(`smoke OK: dsh-harvest 可加载（9 通道），平台=${process.platform}，${buildChannels.length} 通道 build() 平台契约成立，优雅跳过契约成立（${skipped.length}/${PROBE.length} 探测通道记 skipped）`)