// ============================================================================
// dsh-harvest —— 抓取路由层
// 直抓 → 失败升到 r.jina.ai 阅读器 → 仍失败标记 [UNREACHABLE]。
// 402/paywall 不重试，直接标记。返回 { url, status, method, text }。
// HTTP 走 httpGetText（Node fetch + PowerShell 系统代理兜底）。
// ============================================================================

import { httpGetText } from './http.js'

const JINA = 'https://r.jina.ai/'

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

export async function extractOne(url, mode = 'auto') {
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
