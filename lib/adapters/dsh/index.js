import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { setTimeout as sleep } from 'node:timers/promises'
import { createTools } from '../../core/tools.js'
import { getConfig } from '../../core/config.js'
import { deadline, requestJson } from '../../core/http.js'

export const name = 'harvest'
export const inject = ['tools']

function dshConfig(config) {
  // DSH resolves its home as: explicit config -> $DSH_HOME -> ~/.dsh (see @deepseek-ai/dsh-home-paths).
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const read = file => { try { return parse(fs.readFileSync(path.join(home,file),'utf8')) || {} } catch { return {} } }
  const settings = read('settings.yaml').harvest || {}
  const merged = {...settings,...config}
  const ref = merged.tavilyApiKeyEnv || 'TAVILY_API_KEY'
  return getConfig({key:process.env[ref] || read('.credentials.yaml').refs?.[ref],
    endpoint:merged.tavilyEndpoint,researchEndpoint:merged.tavilyResearchEndpoint})
}
export function apply(ctx, config = {}) {
  const resolved = dshConfig(config)
  const tools = createTools({config:resolved})
  const render = (_args,value) => [{type:'text',text:JSON.stringify(value)}]
  for (const tool of tools) ctx.tools.register({name:tool.name,description:tool.description,parameters:tool.parameters,
    output:{schema:{type:'object'},render},execute:(args,exec)=>tool.execute(args,exec)})
  // Legacy DSH name remains available. A timeout returns a resumable task ID.
  const start = tools.find(t=>t.name==='harvest_research_start')
  const status = tools.find(t=>t.name==='harvest_research_status')
  ctx.tools.register({name:'harvest_deep_research',description:'DSH 兼容入口；提交研究并有限轮询，未完成时返回 request_id，使用 harvest_research_status 继续。',
    parameters:{type:'object',properties:{input:{type:'string'},model:{type:'string',enum:['auto','mini','pro']},pollIntervalMs:{type:'integer'},timeoutMs:{type:'integer'}},required:['input'],additionalProperties:false},
    output:{schema:{type:'object'},render},
    async execute({input,model,pollIntervalMs=3000,timeoutMs=300000}, exec) {
      if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 60000 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Invalid polling interval or timeout')
      // Fuse the caller's cancellation with this tool's own polling budget.
      const signal = deadline(exec?.signal,timeoutMs)
      let task = await start.execute({input,...(model ? {model} : {})},{signal})
      try {
        while (!['completed','success','failed','error'].includes(task.status)) {
          await sleep(pollIntervalMs,undefined,{signal})
          task = await status.execute({request_id:task.request_id},{signal})
        }
      } catch (error) { if (!signal.aborted) throw error }
      return task
    }})
  // 可选启动埋点：宿主侧加载失败/静默降级时，这是唯一能一眼看见的证据。
  // 由 DSH_HARVEST_TRACE 开启，只写 stderr，不影响协议输出。
  if (process.env.DSH_HARVEST_TRACE) process.stderr.write(
    `dsh-harvest: registered ${tools.length + 1} tools, web search provider ${resolved.key ? 'ready' : 'unconfigured (no Tavily key)'}\n`)
  ctx.inject?.(['web'], webCtx => {
    webCtx.web.registerSearchProvider({id:'tavily',available:()=>Boolean(resolved.key), async search(request,signal) {
      if (!resolved.key) throw new Error('TAVILY_API_KEY is not configured')
      const data = await requestJson(resolved.endpoint,{method:'POST',signal,
        headers:{Authorization:`Bearer ${resolved.key}`,'Content-Type':'application/json'},
        body:JSON.stringify({query:request.query,max_results:Math.min(10,Math.max(1,request.maxResults || 5))})})
      return {content:data.answer || '',sources:(data.results || []).map(r=>({url:r.url,title:r.title,snippet:r.content,publishedAt:r.published_date})),truncated:false}
    }})
  })
}
