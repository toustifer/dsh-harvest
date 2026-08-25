// ============================================================================
// dsh-harvest —— HTTP 获取层
// Node fetch(undici) 优先；网络失败自动降级 PowerShell Invoke-WebRequest。
// 原因：某些主机(v2ex / r.jina.ai)在部分网络环境下只有走系统代理(WinINET)的
// PowerShell 能连上，而 undici/curl 直连超时。双路兜底让抓取更稳。
// 约定：拿到 HTTP 响应(含 4xx/5xx)就返回 { status, text }；只有网络层失败才抛错。
// ============================================================================

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-harvest/0.1'

function psQuote(s) { return String(s).replace(/'/g, "''") }

export async function httpGetText(url, { headers = {}, timeoutMs = 25000 } = {}) {
  // 1) Node fetch：拿到 HTTP 响应就返回，不因 4xx/5xx 抛错
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA, ...headers },
    })
    return { status: res.status, text: await res.text() }
  } catch (e1) {
    // 2) PowerShell 降级（继承系统代理）
    const hdrs = Object.entries({ 'User-Agent': UA, ...headers })
      .map(([k, v]) => `${k}='${psQuote(v)}'`).join(';')
    const ps = `$r=Invoke-WebRequest -Uri '${psQuote(url)}' -UseBasicParsing -TimeoutSec ${Math.ceil(timeoutMs / 1000)} -Headers @{${hdrs}}; Write-Output $r.StatusCode; Write-Output $r.Content`
    try {
      const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command', ps], {
        timeout: timeoutMs + 15000, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
      })
      const nl = stdout.indexOf('\n')
      const status = parseInt(stdout.slice(0, nl < 0 ? undefined : nl).trim(), 10) || 0
      const text = nl < 0 ? '' : stdout.slice(nl + 1)
      return { status, text }
    } catch (e2) {
      throw new Error(`httpGet failed (fetch: ${String(e1?.message ?? e1)}; ps: ${String(e2?.message ?? e2)})`)
    }
  }
}
