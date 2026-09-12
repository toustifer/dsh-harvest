import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { requestJson } from './http.js'
import { httpUrl } from './config.js'

const terminal = new Set(['completed', 'success', 'failed', 'error'])
export function createResearch(config, request = requestJson) {
  const endpoint = httpUrl(config.researchEndpoint).replace(/\/$/, '')
  const fileFor = id => path.join(config.dataDir, 'tasks', `${createHash('sha256').update(id).digest('hex')}.json`)
  const save = async record => {
    const file = fileFor(record.request_id)
    await fs.mkdir(path.dirname(file), { recursive:true, mode:0o700 })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(record), { mode:0o600 })
      await fs.rename(temp, file)
    } finally { await fs.unlink(temp).catch(() => {}) }
    return file
  }
  const auth = () => {
    if (!config.key) throw new Error('TAVILY_API_KEY is not configured; use scout/extract with available channels instead')
    return { Authorization:`Bearer ${config.key}`, 'Content-Type':'application/json' }
  }
  const normalize = (data, requestId) => ({ request_id:requestId, status:String(data.status || 'unknown'),
    content:typeof data.content === 'string' ? data.content : data.content ? JSON.stringify(data.content) : '',
    sources:Array.isArray(data.sources) ? data.sources : [], updatedAt:new Date().toISOString() })
  return {
    async start({ input, model = 'auto' }, signal) {
      const headers = auth()
      // Preflight persistence before starting a billable task. Never retry POST automatically.
      await fs.mkdir(path.join(config.dataDir, 'tasks'), { recursive:true, mode:0o700 })
      const probe = path.join(config.dataDir, 'tasks', `${randomUUID()}.probe`)
      await fs.writeFile(probe, '', {flag:'wx',mode:0o600})
      await fs.unlink(probe)
      let data
      try { data = await request(endpoint, { method:'POST', headers, body:JSON.stringify({input, model, stream:false}), signal }) }
      catch (error) { throw new Error(`Research submission failed or outcome is unknown. Do not automatically resubmit. ${error.message}`) }
      if (typeof data.request_id !== 'string' || !data.request_id) throw new Error('Research response missing request_id; do not automatically resubmit')
      const record = { ...normalize(data, data.request_id), endpoint, createdAt:new Date().toISOString() }
      try { await save(record) } catch { return { ...record, endpoint:undefined, warning:'Task created but local persistence failed. Keep request_id and query status; do not resubmit.' } }
      return { request_id:record.request_id, status:record.status, content:record.content, pollAfterSeconds:10 }
    },
    async status({ request_id, offset = 0, maxChars = 12000 }, signal) {
      let cached
      try { cached = JSON.parse(await fs.readFile(fileFor(request_id), 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (cached && cached.endpoint !== endpoint) throw new Error('Configured research endpoint differs from saved task; restore the original endpoint')
      const data = cached && terminal.has(cached.status) ? cached : {
        ...normalize(await request(`${endpoint}/${encodeURIComponent(request_id)}`, { headers:auth(), signal }), request_id), endpoint,
      }
      let warning
      try { await save(data) } catch { warning = 'Could not persist latest status; keep request_id' }
      return { request_id, status:data.status, content:data.content.slice(offset, offset + maxChars),
        sources:data.sources.slice(0, 100), sourcesTruncated:data.sources.length > 100,
        contentLength:data.content.length, offset, truncated:offset + maxChars < data.content.length,
        nextOffset:offset + maxChars < data.content.length ? offset + maxChars : null,
        ...(warning ? {warning} : {}), pollAfterSeconds:terminal.has(data.status) ? null : 10 }
    },
  }
}
