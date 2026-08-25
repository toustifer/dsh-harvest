// ============================================================================
// dsh-harvest —— 抓取路由层
// 按 URL 类型自动路由：
//   RSS feed / 小宇宙 episode → feedparser / transcribe.sh
//   普通网页 → 直抓 → 失败升到 r.jina.ai → 仍失败标记 [UNREACHABLE]
// 402/paywall 不重试，直接标记。返回 { url, status, method, text }。
// HTTP 走 httpGetText（Node fetch + PowerShell 系统代理兜底）。
// ============================================================================

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { httpGetText } from './http.js'

const execFileP = promisify(execFile)
const JINA = 'https://r.jina.ai/'
const home = process.env.USERPROFILE || process.env.HOME || '~'

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function looksHtml(text) {
  const head = String(text).slice(0, 2000)
  return /<[a-z][\s\S]*>/i.test(head) || head.trim().startsWith('<!')
}

function isFeed(url, mode) {
  return mode === 'rss' || /\.(rss|atom|xml)(\?|$)/i.test(url) || /\/(feed|rss|atom)(\/|\?|$)/i.test(url)
}
function isXiaoyuzhou(url) {
  return /xiaoyuzhoufm\.com\/episode\//i.test(url)
}

async function direct(url) {
  const { status, text } = await httpGetText(url, { timeoutMs: 20000 })
  if (status === 402) return { url, status: 'paywalled', method: 'direct', text: '' }
  if (status < 200 || status >= 300) throw new Error('HTTP ' + status)
  if (looksHtml(text)) return { url, status: 'ok', method: 'direct', text: stripHtml(text).slice(0, 8000) }
  return { url, status: 'ok', method: 'direct', text: String(text).slice(0, 6000) }
}

async function viaJina(url) {
  const { status, text } = await httpGetText(JINA + url, { timeoutMs: 30000 })
  if (status < 200 || status >= 300) throw new Error('jina HTTP ' + status)
  return { url, status: 'ok', method: 'jina', text: String(text).slice(0, 8000) }
}

// RSS：feedparser 解析最近 10 条
async function rssParse(url) {
  const py = "import feedparser,json,sys; f=feedparser.parse(sys.argv[1]); print(json.dumps([{'title':e.get('title',''),'url':e.get('link',''),'note':(e.get('summary','') or '')[:200]} for e in f.entries[:10]], ensure_ascii=False))"
  try {
    const { stdout } = await execFileP('python', ['-c', py, url], { timeout: 30000, maxBuffer: 5 * 1024 * 1024, windowsHide: true })
    const entries = JSON.parse(stdout)
    const text = entries.map((e) => `${e.title}\n${e.url}\n${e.note}`).join('\n\n')
    return { url, status: 'ok', method: 'rss', text: text.slice(0, 8000) }
  } catch (e) {
    return { url, status: 'unreachable', method: 'rss', text: '', error: String(e?.message ?? e) }
  }
}

// 小宇宙播客：transcribe.sh 转写（需 groq key，未配置则记 unreachable）
async function xiaoyuzhouTranscribe(url) {
  const script = `${home}/.agent-reach/tools/xiaoyuzhou/transcribe.sh`
  try {
    const { stdout } = await execFileP('bash', [script, url], { timeout: 300000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })
    return { url, status: 'ok', method: 'xiaoyuzhou', text: String(stdout).slice(0, 12000) }
  } catch (e) {
    return { url, status: 'unreachable', method: 'xiaoyuzhou', text: '', error: String(e?.message ?? e) }
  }
}

export async function extractOne(url, mode = 'auto') {
  if (isFeed(url, mode)) return rssParse(url)
  if (isXiaoyuzhou(url)) return xiaoyuzhouTranscribe(url)
  if (mode === 'jina') {
    try { return await viaJina(url) } catch (e) { return { url, status: 'unreachable', method: 'jina', text: '', error: String(e?.message ?? e) } }
  }
  try {
    return await direct(url)
  } catch (e) {
    const firstErr = String(e?.message ?? e)
    try {
      const out = await viaJina(url)
      out.note = `direct 失败(${firstErr})，已升级 jina`
      return out
    } catch (e2) {
      return { url, status: 'unreachable', method: 'direct+jina', text: '', error: `${firstErr}; ${String(e2?.message ?? e2)}` }
    }
  }
}
