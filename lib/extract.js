// ============================================================================
// dsh-harvest —— 抓取路由层
// 直抓 → 失败升到 r.jina.ai 阅读器 → 仍失败标记 [UNREACHABLE]。
// 402/paywall 不重试，直接标记。返回 { url, status, method, text }。
// ============================================================================

const JINA = 'https://r.jina.ai/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-harvest/0.1'

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function direct(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
  })
  if (res.status === 402) return { url, status: 'paywalled', method: 'direct', text: '' }
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const ct = res.headers.get('content-type') || ''
  const body = await res.text()
  if (ct.includes('html')) return { url, status: 'ok', method: 'direct', text: stripHtml(body).slice(0, 8000) }
  return { url, status: 'ok', method: 'direct', text: body.slice(0, 6000) }
}

async function viaJina(url) {
  const res = await fetch(JINA + url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error('jina HTTP ' + res.status)
  return { url, status: 'ok', method: 'jina', text: String(await res.text()).slice(0, 8000) }
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
