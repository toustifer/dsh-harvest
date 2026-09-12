import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { httpGetText, deadline } from './http.js'
import { httpUrl } from './config.js'
import { command, resolveCommand, runCommand } from './process.js'

export function stripHtml(html) {
  return String(html).replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}
function pageText(raw) {
  return /^\s*<(?:!doctype|html|body|p|div|article)\b/i.test(raw) ? stripHtml(raw) : raw.trim()
}
function usable(text) {
  return text.trim().length > 0 && !(text.length < 1000 && /enable javascript|javascript is required|sign in to continue|verify you are human|checking your browser/i.test(text))
}
export async function extractOne(url, mode = 'auto', options = {}) {
  const { maxChars = 8000, signal: parent, get = httpGetText } = options
  const signal = deadline(parent, 40000)
  const base = { url, fetchedAt: new Date().toISOString() }
  const result = async (status, method, text = '', extra = {}) => {
    let artifactPath, warning
    if (options.saveFullText && text && options.dataDir) {
      try {
        const dir = path.join(options.dataDir, 'sources')
        await fs.mkdir(dir, {recursive:true,mode:0o700})
        artifactPath = path.join(dir, `${randomUUID()}.json`)
        await fs.writeFile(artifactPath, JSON.stringify({...base,status,method,text}), {mode:0o600,flag:'wx'})
      } catch { artifactPath = undefined; warning = 'Could not save full text' }
    }
    return { ...base, status, method, text:text.slice(0,maxChars), textLength:text.length, truncated:text.length>maxChars,
      ...(artifactPath ? {artifactPath} : {}), ...(warning ? {warning} : {}), ...extra }
  }
  try {
    httpUrl(url)
    if (mode === 'rss' || /\.(rss|atom|xml)(\?|$)|\/(feed|rss|atom)(\/|\?|$)/i.test(url)) {
      const py = ['python3', 'python', 'py'].find(resolveCommand)
      if (!py) throw new Error('RSS requires Python and feedparser')
      // Fetch with the shared HTTP deadline before parsing; feedparser performs no network request.
      const response = await get(url, { signal })
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'harvest-feed-'))
      try {
        const file = path.join(temp, 'feed.xml')
        await fs.writeFile(file, response.text)
        const script = "import feedparser,json,sys; f=feedparser.parse(sys.argv[1]); print(json.dumps([{'title':e.get('title',''),'url':e.get('link',''),'text':e.get('summary','')} for e in f.entries[:10]],ensure_ascii=False))"
        const raw = await runCommand(command(py, ['-c', script, file]), { signal, timeoutMs:10000 })
        const entries = JSON.parse(raw)
        return result(entries.length ? 'ok' : 'empty', 'rss', entries.map(e => `${e.title}\n${e.url}\n${stripHtml(e.text)}`).join('\n\n'))
      } finally { await fs.unlink(path.join(temp,'feed.xml')).catch(()=>{}); await fs.rmdir(temp) }
    }
    if (/^(www\.)?xiaoyuzhoufm\.com$/i.test(new URL(url).hostname) && new URL(url).pathname.startsWith('/episode/')) {
      return result('unsupported', 'xiaoyuzhou', '', { error:'Podcast transcription is not run inside a short extraction call; supply a transcript or use a dedicated transcription tool.' })
    }
    if (mode !== 'jina') {
      try {
        const response = await get(url, { signal, timeoutMs:15000 })
        if (response.status === 402) return result('paywalled', 'direct')
        if (response.status >= 200 && response.status < 300) {
          const text = pageText(response.text)
          if (usable(text)) return result('ok', 'direct', text)
        }
      } catch (error) { if (signal.aborted) throw error }
    }
    signal.throwIfAborted()
    const response = await get(`https://r.jina.ai/${url}`, { signal, timeoutMs:20000 })
    if (response.status === 402) return result('paywalled', 'jina')
    if (response.status < 200 || response.status >= 300) throw new Error(`Reader HTTP ${response.status}`)
    return result(usable(response.text) ? 'ok' : 'empty', 'jina', response.text)
  } catch (error) {
    return result(signal.aborted ? 'cancelled' : 'unreachable', mode, '', { error:String(error.message) })
  }
}
