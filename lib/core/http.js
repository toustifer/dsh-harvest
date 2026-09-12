import { httpUrl } from './config.js'
import { runCommand } from './process.js'

export const MAX_BYTES = 2 * 1024 * 1024
export function deadline(signal, timeoutMs = 20000) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
}
async function readBody(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Response exceeds 2 MiB limit')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Response exceeds 2 MiB limit') }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { reader.releaseLock() }
}
export async function requestJson(url, { signal, timeoutMs = 20000, ...options } = {}) {
  const response = await fetch(httpUrl(url), { ...options, redirect: 'error', signal: deadline(signal, timeoutMs) })
  const text = await readBody(response)
  if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`)
  try { return JSON.parse(text) } catch { throw new Error('Service returned invalid JSON') }
}
export async function httpGetText(url, { headers = {}, timeoutMs = 20000, signal, fallback = true } = {}) {
  url = httpUrl(url)
  const bounded = deadline(signal, timeoutMs)
  const merged = { 'user-agent': 'harvest/0.3', ...headers }
  let response
  try {
    response = await fetch(url, { headers: merged, redirect: 'follow', signal: bounded })
  } catch (error) {
    if (bounded.aborted || !fallback) throw error
    const args = ['--silent', '--show-error', '--location', '--max-redirs', '5', '--proto', '=http,https',
      '--proto-redir', '=http,https', '--max-filesize', String(MAX_BYTES), '--max-time', String(timeoutMs / 1000),
      ...Object.entries(merged).flatMap(([k, v]) => ['--header', `${k}: ${v}`]), '--write-out', '\n%{http_code}', '--url', url]
    const raw = await runCommand({ file: process.platform === 'win32' ? 'curl.exe' : 'curl', args }, { signal: bounded, timeoutMs })
    const split = raw.lastIndexOf('\n')
    const status = Number(raw.slice(split + 1).trim())
    if (split < 0 || !status) throw new Error('Invalid HTTP fallback response')
    return { status, text: raw.slice(0, split) }
  }
  return { status: response.status, text: await readBody(response) }
}
