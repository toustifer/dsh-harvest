// ============================================================================
// dsh-harvest —— DSH 原生多平台调研流水线插件（零 @deepseek-ai 依赖，自包含）
// ----------------------------------------------------------------------------
// 工具四件套（全下划线命名，符合 OpenAI 工具名规范）：
//   harvest_scout   多平台并行发现（GitHub / Web·Exa / Twitter / Reddit / 小红书 / YouTube）
//   harvest_extract 逐条抓取（直抓 → r.jina.ai 升级 → 标记 paywall/unreachable）
//   harvest_verify  跨源交叉验证（一致/冲突/未证实）
//   harvest_audit   来源可信度审计（权威性/一手性/可验证/时效/偏见 → 🟢🟡🔴）
// 血统：源自自研 omni-scope 方法论，按 DSH 原生插件形态重写。
// 工具注册契约：ctx.tools.register({ name, description, parameters, output, execute })。
// ============================================================================

import { BACKENDS, scoutChannel } from './backends.js'
import { extractOne } from './extract.js'

const name = 'harvest'
const inject = ['tools']

const text = (t) => [{ type: 'text', text: t }]

function validate(value, schema, path = '') {
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) throw new Error(`${path} 必须是 ${schema.enum.join('/')} 之一`)
    return
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} 必须是对象`)
      for (const key of schema.required || []) if (value[key] === undefined) throw new Error(`${path}.${key} 必填`)
      for (const [key, sub] of Object.entries(schema.properties || {})) if (value[key] !== undefined) validate(value[key], sub, `${path}.${key}`)
      if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(schema.properties || {})[key]) throw new Error(`${path}.${key} 是未声明字段`)
      return
    }
    case 'array': { if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`); if (schema.items) for (const item of value) validate(item, schema.items, `${path}[]`); return }
    case 'string': if (typeof value !== 'string') throw new Error(`${path} 必须是字符串`); return
    case 'integer': case 'number': if (typeof value !== 'number') throw new Error(`${path} 必须是数字`); return
    case 'boolean': if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔`); return
    default: return
  }
}

function defineTool({ name: toolName, description, parameters, output, execute, render }) {
  return {
    name: toolName,
    description,
    parameters,
    output: { schema: output.schema, ...(render ? { render } : {}) },
    async execute(args) { validate(args, parameters); return execute(args) },
  }
}

// 把若干短串拼成关键词集合，做朴素命中统计。
function tokensOf(...parts) {
  const s = parts.filter(Boolean).join(' ').toLowerCase()
  const cjk = s.match(/[\u4e00-\u9fff]{2,}/g) || []
  const en = s.match(/[a-z0-9]{3,}/g) || []
  return [...new Set([...cjk, ...en])]
}

const PLATFORMS = Object.keys(BACKENDS)

function apply(ctx, config = {}) {
  const log = ctx.logger ? ctx.logger(name) : console

  const tools = [
    // ----------------------------------------------------------------------
    defineTool({
      name: 'harvest_scout',
      description: '多平台并行发现候选来源：GitHub 代码、Web/Exa 搜索、Twitter、Reddit、小红书、YouTube、B站、V2EX、LinkedIn。任一道失败自动记入 skipped 不阻塞；返回 5-15 条带 URL 的候选源。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          query: { type: 'string', description: '调研主题关键词，如 "new AI projects 2026" / "世界模型"' },
          platforms: { type: 'array', items: { type: 'string', enum: PLATFORMS }, description: `指定通道子集，默认全部：${PLATFORMS.join('/')}` },
          limit: { type: 'integer', description: '每通道结果数，默认 8' },
        },
        required: ['query'],
      },
      output: { schema: { type: 'object', properties: { query: { type: 'string' }, total: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } }, skipped: { type: 'array', items: { type: 'object' } } }, required: ['query', 'total', 'items', 'skipped'] } },
      async execute(args) {
        const limit = args.limit || 8
        const want = args.platforms && args.platforms.length ? args.platforms : PLATFORMS
        const results = await Promise.all(want.map(async (id) => {
          try {
            const items = await scoutChannel(id, args.query, limit)
            return { ok: true, id, items }
          } catch (e) {
            return { ok: false, id, reason: String(e?.message ?? e) }
          }
        }))
        const items = results.filter((r) => r.ok).flatMap((r) => r.items)
        const skipped = results.filter((r) => !r.ok).map((r) => ({ platform: r.id, reason: r.reason }))
        return { query: args.query, total: items.length, items, skipped }
      },
      render: (_a, v) => {
        const lines = v.items.map((i) => `[${i.platform}] ${i.title}\n  ${i.url || '(无 URL)'}${i.note ? `\n  ${i.note.slice(0, 160)}` : ''}`)
        const skip = v.skipped.map((s) => `[SKIP:${s.platform}] ${s.reason}`)
        return text([...lines, ...skip].join('\n') || '(无结果)')
      },
    }),

    // ----------------------------------------------------------------------
    defineTool({
      name: 'harvest_extract',
      description: '逐条抓取 URL 正文：静态页直抓，403/JS 页自动升级 r.jina.ai，paywall(402) 与不可达分别标记。自动识别 RSS feed(feedparser) 与小宇宙播客 URL(Whisper 转写)。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: '要抓取的 URL 列表' },
          mode: { type: 'string', enum: ['auto', 'jina'], description: 'auto 直抓失败自动升级；jina 强制走阅读器。默认 auto' },
        },
        required: ['urls'],
      },
      output: { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } } }, required: ['results'] } },
      async execute(args) {
        const results = []
        for (const url of args.urls.slice(0, 10)) results.push(await extractOne(url, args.mode || 'auto'))
        return { results }
      },
      render: (_a, v) => text(v.results.map((r) => `[${r.status}/${r.method}] ${r.url}${r.text ? `\n  ${r.text.slice(0, 500)}` : ''}`).join('\n')),
    }),

    // ----------------------------------------------------------------------
    defineTool({
      name: 'harvest_verify',
      description: '跨源交叉验证：对每条待证断言做关键词命中统计，标记 一致(verified, ≥2 源)/ 弱(weak, 1 源)/ 未证实(unverified, 0 源)。搜索摘要不算一手来源，须与原文比对。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          claims: { type: 'array', items: { type: 'string' }, description: '待验证的断言列表' },
          sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, text: { type: 'string' } }, required: ['title'] }, description: '已抓取的来源（含 text 用于命中）' },
        },
        required: ['claims'],
      },
      output: { schema: { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object' } } }, required: ['verdicts'] } },
      async execute(args) {
        const sources = args.sources || []
        const verdicts = (args.claims || []).map((claim) => {
          const toks = tokensOf(claim)
          const matches = sources.filter((s) => {
            const hay = tokensOf(s.text || '', s.title)
            return toks.length ? toks.some((t) => hay.includes(t)) : false
          })
          const status = matches.length >= 2 ? 'verified' : matches.length === 1 ? 'weak' : 'unverified'
          return { claim, status, matches: matches.length, matched: matches.map((m) => m.url || m.title) }
        })
        return { verdicts }
      },
      render: (_a, v) => text(v.verdicts.map((x) => `[${x.status}] ${x.claim}  (${x.matches} 源)`).join('\n')),
    }),

    // ----------------------------------------------------------------------
    defineTool({
      name: 'harvest_audit',
      description: '来源可信度审计：按 权威性/一手性/可验证/时效/偏见 五维给出启发式评分与 🟢可信/🟡谨慎/🔴弃用 判定。启发式仅供参考，最终判定由你结合内容复核。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, type: { type: 'string', description: 'official/gov/edu/media/report/social/code/unknown' } }, required: ['title'] }, description: '来源列表' },
        },
        required: ['sources'],
      },
      output: { schema: { type: 'object', properties: { matrix: { type: 'array', items: { type: 'object' } } }, required: ['matrix'] } },
      async execute(args) {
        const matrix = (args.sources || []).map((s) => {
          const u = (s.url || '').toLowerCase()
          const t = (s.type || 'unknown').toLowerCase()
          let authority = 2, firsthand = 2, verifiable = 2, timeliness = 2, bias = 2
          if (/\.(gov|edu)\b/.test(u) || ['gov', 'edu', 'official'].includes(t)) authority = 4
          if (t === 'code') {
            // 一手代码仓库：可核验性最高（代码即真相），权威/时效/偏见小幅上调
            authority = 3; firsthand = 4; verifiable = 4; timeliness = 3; bias = 3
          } else if (['official', 'report'].includes(t) || /(api|docs|github|arxiv)\./.test(u)) {
            firsthand = 4
          }
          if (t === 'social') { firsthand = 1; authority = 1; bias = 1 }
          if (t === 'unknown') { verifiable = 1; authority = 1 }
          if (t === 'media') { verifiable = 3; timeliness = 3 }
          const sum = authority + firsthand + verifiable + timeliness + bias
          const verdict = sum >= 17 ? 'trust' : sum >= 11 ? 'caution' : 'discard'
          return { title: s.title, url: s.url || '', type: t, authority, firsthand, verifiable, timeliness, bias, sum, verdict }
        })
        return { matrix }
      },
      render: (_a, v) => text(v.matrix.map((m) => `[${m.verdict}] ${m.title}  (${m.sum}/20)`).join('\n')),
    }),
  ]

  for (const tool of tools) ctx.tools.register(tool)
  log.info(`harvest ready (tools=${tools.length}, platforms=${PLATFORMS.join(',')})`)
}

export { name, inject, apply }
