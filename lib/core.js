import { z } from 'zod'
import { BACKENDS, scoutChannel } from './backends.js'
import { extractOne } from './extract.js'
import { getConfig, httpUrl, publicError } from './config.js'
import { deadline } from './http.js'
import { resolveCommand, runCommand, command } from './process.js'
import { collectEvidence, auditSources, dedupeSources } from './evidence.js'
import { createResearch } from './research.js'

const url = z.string().max(4096).refine(value => { try { httpUrl(value); return true } catch { return false } }, 'Expected HTTP(S) URL without credentials')
const text = z.string().trim().min(1)
const source = z.object({title:z.string().max(500), url:z.string().max(4096).optional(), text:z.string().max(50000).optional(),
  type:z.string().max(50).optional(), publishedAt:z.string().max(100).optional()}).strict()

export function createTools(options = {}) {
  const config = getConfig(options.config)
  const scout = options.scout || scoutChannel
  const extract = options.extract || extractOne
  const research = createResearch(config, options.request)
  const make = (name, description, schema, execute, readOnly = true) => ({ name, description, schema,
    parameters:z.toJSONSchema(schema), annotations:{readOnlyHint:readOnly, destructiveHint:false, idempotentHint:readOnly, openWorldHint:true},
    async execute(args, context = {}) {
      const validated = schema.parse(args)
      context.signal?.throwIfAborted()
      return execute(validated, context)
    } })
  return [
    make('harvest_doctor', '检查本地渠道依赖与凭据是否配置，不发起付费搜索；本地存在不代表已登录或在线可用。', z.object({}).strict(), async (_, {signal}) => {
      const dependencies = await Promise.all(['gh','mcporter','opencli','yt-dlp','bili','python3','python','py'].map(async name => {
        const executable = resolveCommand(name)
        if (!executable) return {name,status:'missing'}
        try {
          await runCommand(command(name, ['--version']), {signal, timeoutMs:2000})
          return {name,status:'installed', onlineStatus:'not_checked'}
        } catch { return {name,status:'found_but_unverified', onlineStatus:'not_checked'} }
      }))
      return {runtime:process.version, platform:process.platform, dependencies, tavily:{configured:Boolean(config.key), onlineStatus:'not_checked'},
        dataDir:config.dataDir, note:'Codex session web tools are selected by the Skill; they are not callable inside this MCP process.'}
    }),
    make('harvest_scout', '按所选渠道发现候选来源；默认 GitHub/Web。空结果与渠道失败分别返回，搜索摘要不能当作核验证据。',
      z.object({query:text.max(2000), platforms:z.array(z.enum(Object.keys(BACKENDS))).min(1).max(9).optional(), limit:z.number().int().min(1).max(10).default(5)}).strict(),
      async ({query, platforms = ['web','github'], limit}, {signal}) => {
        const bounded = deadline(signal, 25000)
        const warnings = []
        const channels = await Promise.all([...new Set(platforms)].map(async platform => {
          try {
            const items = await scout(platform, query, limit, {signal:bounded, config, warnings})
            return {platform, status:items.length ? 'ok' : 'empty', items:items.slice(0, limit)}
          } catch (error) { return {platform,status:'skipped',reason:publicError(error, config.key), items:[]} }
        }))
        signal?.throwIfAborted()
        const raw = channels.flatMap(c => c.items)
        const items = dedupeSources(raw)
        return {query,total:items.length, items, omitted:raw.length - items.length,
          channels:channels.map(({items,...rest})=>rest), skipped:channels.filter(c=>c.status==='skipped').map(({items,...rest})=>rest), warnings}
      }),
    make('harvest_extract', '读取最多 3 个 URL 正文（每次最长 45 秒）。返回抓取时间、截断标记；可提升 maxChars 获取更多原文。付费墙和空正文单独标记。',
      z.object({urls:z.array(url).min(1).max(3), mode:z.enum(['auto','jina','rss']).default('auto'), maxChars:z.number().int().min(500).max(50000).default(8000),saveFullText:z.boolean().default(false)}).strict(),
      async ({urls, mode, maxChars, saveFullText}, {signal}) => {
        const bounded = deadline(signal, 45000)
        const results = await Promise.all(urls.map(u => extract(u, mode, {signal:bounded,maxChars,saveFullText,dataDir:config.dataDir})))
        signal?.throwIfAborted()
        return {results}
      }, false),
    make('harvest_verify', '整理断言的原文候选片段并按 URL 去重；仅词汇检索，不输出已验证结论。需要 Codex 判断支持/反驳/不足。',
      z.object({claims:z.array(text.max(2000)).min(1).max(10), sources:z.array(source).max(20).default([])}).strict(),
      async ({claims,sources}) => collectEvidence(claims,sources)),
    make('harvest_audit', '列出来源元数据与待核查项，不用域名或类型自动打可信度分数。',
      z.object({sources:z.array(source).max(30)}).strict(), async ({sources}) => auditSources(sources)),
    make('harvest_research_start', '提交 Tavily 外部研究任务（需要 TAVILY_API_KEY，可能产生服务费用）。立即返回 request_id；超时不得自动重复提交。',
      z.object({input:text.max(10000),model:z.enum(['auto','mini','pro']).default('auto')}).strict(), (args,{signal})=>research.start(args,signal), false),
    make('harvest_research_status', '通过 request_id 查询一次研究进度；已完成报告本地缓存，重启后可继续读取。offset/maxChars 分页读取报告。',
      z.object({request_id:text.max(200), offset:z.number().int().min(0).default(0), maxChars:z.number().int().min(500).max(50000).default(12000)}).strict(),
      (args,{signal})=>research.status(args,signal)),
  ]
}
