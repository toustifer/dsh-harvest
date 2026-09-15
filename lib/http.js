// ============================================================================
// dsh-harvest —— HTTP 获取层
// Node fetch(undici) 优先；网络失败自动降级系统代理兜底：
//   win32 → PowerShell Invoke-WebRequest（WinINET 读系统代理）；
//   mac/linux → curl（预装，https_proxy/http_proxy 环境变量已设时自动读代理）。
// 原因：某些主机(v2ex / r.jina.ai)在部分网络环境下只有走系统代理的路径能连上，
// 而 undici/curl 直连超时。双路兜底让抓取更稳。
// 约定：拿到 HTTP 响应(含 4xx/5xx)就返回 { status, text }；只有网络层失败才抛错。
// ============================================================================

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-harvest/0.1'
const IS_WIN = process.platform === 'win32'

function psQuote(s) { return String(s).replace(/'/g, "''") }

export async function httpGet(url, { headers = {}, timeoutMs = 25000 } = {}) {
  // header 统一小写合并：调用方优先，避免 User-Agent / user-agent 撞键
  const merged = { 'user-agent': UA, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v])) }
  // 1) Node fetch：拿到 HTTP 响应就返回，不因 4xx/5xx 抛错
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: merged,
    })
    const buffer = Buffer.from(await res.arrayBuffer())
    return { status: res.status, buffer }
  } catch (e1) {
    // 2) 平台分支兜底（网络层失败才进）：win32 走 PowerShell(继承系统代理)；非 win32 走 curl
    try {
      let stdout
      if (!IS_WIN) {
        // curl：-A 负责 user-agent（取合并后的值，调用方仍可覆盖）；其余 header 逐个 -H，避免重复 User-Agent
        const hdrs = Object.entries(merged)
          .filter(([k]) => k !== 'user-agent')
          .map(([k, v]) => ['-H', `${k}: ${v}`]).flat()
        const argv = ['-sS', '-o', '-', '-w', '\n%{http_code}', '-A', merged['user-agent'], ...hdrs, url]
        stdout = (await execFileP('curl', argv, {
          timeout: timeoutMs + 15000, maxBuffer: 10 * 1024 * 1024, encoding: null,
        })).stdout
      } else {
        const hdrs = Object.entries(merged)
          .map(([k, v]) => `'${k}' = '${psQuote(v)}'`).join('; ')
        const ps = `$r=Invoke-WebRequest -Uri '${psQuote(url)}' -UseBasicParsing -TimeoutSec ${Math.ceil(timeoutMs / 1000)} -Headers @{${hdrs}}; Write-Output $r.StatusCode; [System.Console]::OpenStandardOutput().Write($r.Content, 0, $r.Content.Length)`
        stdout = (await execFileP('powershell.exe', ['-NoProfile', '-Command', ps], {
          timeout: timeoutMs + 15000, maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: null,
        })).stdout
      }
      const nl = !IS_WIN ? stdout.lastIndexOf(10) : stdout.indexOf(10)
      const statusLine = stdout.slice(!IS_WIN ? nl + 1 : 0, !IS_WIN ? stdout.length : nl).toString().trim()
      const status = parseInt(statusLine, 10) || 0
      const buffer = nl < 0 ? Buffer.alloc(0) : (IS_WIN ? stdout.slice(nl + 1) : stdout.slice(0, nl))
      return { status, buffer }
    } catch (e2) {
      throw new Error(`httpGet failed (fetch: ${String(e1?.message ?? e1)}; ${IS_WIN ? 'ps' : 'curl'}: ${String(e2?.message ?? e2)})`)
    }
  }
}

export async function httpGetText(url, options) {
  const { status, buffer } = await httpGet(url, options)
  return { status, text: buffer.toString('utf-8') }
}
