// ============================================================================
// dsh-harvest —— 通道封装层（零依赖，自包含）
// 每个通道声明：如何拼命令、如何把 CLI 输出归一化成 { platform, title, url, note }。
// 任一通道失败（CLI 缺失 / 浏览器桥接未连 / 解析失败）一律抛错，由 index.js 捕获后
// 记入 skipped[]，绝不阻塞整条 scout。
// ============================================================================

import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { httpGetText } from './http.js'

const execFileP = promisify(execFile)
const TIMEOUT = 90_000

// —— 平台分支（零依赖）——
// opencli / mcporter 的平台形态不同：
//   win32：npm 全局装法生成 .ps1/.cmd 垫片，execFile 无法直接执行 → 经 powershell.exe 以绝对路径调用；
//   mac/linux：npm 全局装的是可执行脚本/二进制，execFile 可直接跑 → argv 直调，不拼 shell 字符串。
// 垫片目录可用 DSH_HARVEST_BIN 覆盖，默认 os.homedir()/.npm-global（跨平台，不再硬编码 Windows 路径）。
const IS_WIN = process.platform === 'win32'
const SHIM_DIR = process.env.DSH_HARVEST_BIN || path.join(os.homedir(), '.npm-global')
function psq(s) { return String(s).replace(/'/g, "''") }
function psShim(name) { return `& '${psq(path.join(SHIM_DIR, `${name}.ps1`))}'` }

// 统一垫片入口：win32 经 powershell.exe 跑 psExpr；非 win32 直接 argv 直调 cli。
function shimRun(cli, psExpr, argv) {
  if (!IS_WIN) return { file: cli, args: argv }
  return { file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim(cli)} ${psExpr}`] }
}

function q(s) { return String(s ?? '') }

// 宽容地取出 CLI 输出里第一个 JSON 值（数组或对象），解析失败返回 null。
function tryJson(raw) {
  const text = q(raw)
  const start = Math.min(
    ...[text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0)
  )
  if (start === Infinity || start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

// 从任意形状的对象里捞候选条目：优先数组本身 / data / results / items / list。
function normalizeItems(parsed, platform) {
  let arr = null
  if (Array.isArray(parsed)) arr = parsed
  else if (parsed && typeof parsed === 'object') {
    for (const k of ['data', 'results', 'items', 'list', 'posts', 'tweets']) {
      if (Array.isArray(parsed[k])) { arr = parsed[k]; break }
    }
  }
  if (!arr) return []
  return arr.slice(0, 30).map((it) => {
    if (typeof it === 'string') return { platform, title: it.slice(0, 120), url: '', note: '' }
    const o = it && typeof it === 'object' ? it : {}
    const title = o.fullName ?? o.title ?? o.name ?? o.text ?? o.id ?? ''
    const url = o.url ?? o.html_url ?? o.link ?? o.webpage_url ?? o.permalink ?? ''
    const note = o.description ?? o.note ?? o.snippet ?? ''
    return {
      platform,
      title: String(title).slice(0, 200),
      url: String(url || ''),
      note: String(note || '').slice(0, 400),
    }
  }).filter((x) => x.title || x.url)
}

async function run(args) {
  const { file, args: argv } = args
  const { stdout } = await execFileP(file, argv, {
    timeout: TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

import fs from 'node:fs'

function getTavilyWebConfig() {
  let key = process.env.TAVILY_API_KEY
  let endpoint = process.env.TAVILY_ENDPOINT
  const dshHome = process.env.USERPROFILE || 'C:\\Users\\15775'
  try {
    const settingsPath = path.join(dshHome, '.dsh', 'settings.yaml')
    if (fs.existsSync(settingsPath)) {
      const sContent = fs.readFileSync(settingsPath, 'utf8')
      const epMatch = sContent.match(/tavilyEndpoint:\s*(\S+)/)
      if (epMatch && !endpoint) endpoint = epMatch[1]
      const keyEnvMatch = sContent.match(/tavilyApiKeyEnv:\s*(\S+)/)
      const keyRef = keyEnvMatch ? keyEnvMatch[1] : 'TAVILY_API_KEY'
      if (!key) {
        const credPath = path.join(dshHome, '.dsh', '.credentials.yaml')
        if (fs.existsSync(credPath)) {
          const cContent = fs.readFileSync(credPath, 'utf8')
          const regex = new RegExp(`${keyRef}:\\s*(\\S+)`)
          const kMatch = cContent.match(regex)
          if (kMatch) key = kMatch[1]
        }
      }
    }
  } catch (_) {}
  if (!endpoint) endpoint = 'https://api.tavily.com/search'
  return { key, endpoint }
}

// --- Telegram / LINUX DO 深度情报通道辅助方法 ---
function probeFile(p) {
  if (!p) return false
  if (path.isAbsolute(p)) return fs.existsSync(p)
  try {
    const res = spawnSync(p, ['--version'], { stdio: 'ignore' })
    return res.status === 0
  } catch {
    return false
  }
}

function getTelegramPython() {
  if (process.env.TELEGRAM_PYTHON) return process.env.TELEGRAM_PYTHON
  const basePath = process.env.TELEGRAM_MCP_PATH || 'D:\\myprogram\\tools\\mcp-telegram'
  const venvPyWin = path.join(basePath, '.venv', 'Scripts', 'python.exe')
  const venvPyNix = path.join(basePath, '.venv', 'bin', 'python')
  if (fs.existsSync(venvPyWin)) return venvPyWin
  if (fs.existsSync(venvPyNix)) return venvPyNix
  return IS_WIN ? venvPyWin : 'python3'
}

function hasTelegramSession() {
  if (process.env.TELEGRAM_SESSION && fs.existsSync(process.env.TELEGRAM_SESSION)) return true
  const basePath = process.env.TELEGRAM_MCP_PATH || 'D:\\myprogram\\tools\\mcp-telegram'
  const stateDir = process.env.XDG_STATE_HOME
    ? (path.isAbsolute(process.env.XDG_STATE_HOME) ? path.join(process.env.XDG_STATE_HOME, 'mcp-telegram') : path.resolve(process.env.XDG_STATE_HOME, 'mcp-telegram'))
    : path.join(basePath, '.state', 'mcp-telegram')
  const sessionFile = path.join(stateDir, 'session.session')
  return fs.existsSync(sessionFile)
}

function probeTelegram() {
  const py = getTelegramPython()
  if (!probeFile(py)) return false
  if (!hasTelegramSession()) return false
  return true
}

const TG_SCRIPT = `
import os, sys, json, asyncio
q = sys.argv[1] if len(sys.argv) > 1 else ""
n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
p = os.environ.get("TELEGRAM_MCP_PATH", r"D:\\myprogram\\tools\\mcp-telegram")
sp = os.path.join(p, "src")
if os.path.exists(sp): sys.path.insert(0, sp)
os.environ.setdefault("XDG_STATE_HOME", os.path.join(p, ".state"))
os.environ.setdefault("TELEGRAM_PROXY", "http://127.0.0.1:7897")
os.environ.setdefault("API_ID", "2834")
os.environ.setdefault("API_HASH", "68875f756c9b437a8b916ca3de215815")
from mcp_telegram.telegram import Telegram
tg = Telegram()
tg.create_client()
async def search():
    try:
        await asyncio.wait_for(tg.client.connect(), timeout=8)
        if not await tg.client.is_user_authorized():
            raise RuntimeError("Telegram session not authorized, please login first")
        items = []
        async for msg in tg.client.iter_messages(None, search=q, limit=n):
            sender = ""
            if msg.sender:
                sender = getattr(msg.sender, "title", None) or getattr(msg.sender, "first_name", "") or str(getattr(msg, "sender_id", ""))
            text = msg.text or ""
            snippet = text[:300]
            text_snippet = snippet[:80].replace("\\n", " ")
            title = f"{sender}: {text_snippet}" if sender else text_snippet
            link = getattr(msg, "link", None)
            if not link and msg.chat_id:
                cid = str(msg.chat_id)
                if cid.startswith("-100"): cid = cid[4:]
                link = f"https://t.me/c/{cid}/{msg.id}"
            items.append({"title": title or "Telegram Message", "url": link or "https://t.me/", "snippet": text})
        print(json.dumps(items, ensure_ascii=False))
    finally:
        try:
            await tg.client.disconnect()
        except Exception:
            pass
try:
    asyncio.run(search())
except Exception as e:
    sys.stderr.write(f"Telegram error: {e}\\n")
    sys.exit(1)
`.trim()

function getLinuxDoPython() {
  if (process.env.LINUXDO_PYTHON) return process.env.LINUXDO_PYTHON
  const basePath = process.env.LINUXDO_MCP_PATH || 'D:\\myprogram\\tools\\linuxdo-mcp'
  const venvPyWin = path.join(basePath, '.venv', 'Scripts', 'python.exe')
  const venvPyNix = path.join(basePath, '.venv', 'bin', 'python')
  if (fs.existsSync(venvPyWin)) return venvPyWin
  if (fs.existsSync(venvPyNix)) return venvPyNix
  return IS_WIN ? venvPyWin : 'python3'
}

function hasLinuxDoCookie() {
  if (process.env.LINUXDO_COOKIE) return true
  const basePath = process.env.LINUXDO_MCP_PATH || 'D:\\myprogram\\tools\\linuxdo-mcp'
  const envFile = path.join(basePath, '.env')
  if (fs.existsSync(envFile)) {
    try {
      const content = fs.readFileSync(envFile, 'utf8')
      if (/LINUXDO_COOKIE\s*=/i.test(content)) return true
    } catch (_) {}
  }
  const cacheFile = process.env.LINUXDO_CACHE_DIR
    ? path.join(process.env.LINUXDO_CACHE_DIR, 'cookie.json')
    : path.join(os.homedir(), '.cache', 'linuxdo-mcp', 'cookie.json')
  return fs.existsSync(cacheFile)
}

function probeLinuxDo() {
  const py = getLinuxDoPython()
  if (!probeFile(py)) return false
  if (!hasLinuxDoCookie()) return false
  return true
}

const LINUXDO_SCRIPT = `
import os, sys, json
q = sys.argv[1] if len(sys.argv) > 1 else ""
n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
p = os.environ.get("LINUXDO_MCP_PATH", r"D:\\myprogram\\tools\\linuxdo-mcp")
sp = os.path.join(p, "src")
if os.path.exists(sp): sys.path.insert(0, sp)
ef = os.path.join(p, ".env")
if os.path.exists(ef):
    with open(ef, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
try:
    from linuxdo_mcp.server import _search
    r = _search(q, 1, 1)
    items = []
    for t in r.get("results", [])[:n]:
        tid = t.get("topic_id")
        u = t.get("url") or (f"https://linux.do/t/{tid}" if tid else "https://linux.do")
        items.append({
            "title": t.get("title") or "",
            "url": u,
            "snippet": t.get("blurb") or "",
        })
    print(json.dumps(items, ensure_ascii=False))
except Exception as e:
    sys.stderr.write(f"LINUX DO error: {e}\\n")
    sys.exit(1)
`.trim()

// --- LINUX DO 频控节流、短时缓存与 429 熔断窗口 ---
export const linuxdoThrottleState = {
  lastRequestTime: 0,
  minIntervalMs: 2500,
  cacheTtlMs: 3 * 60 * 1000,
  maxCacheSize: 100,
  cooldownMs: 60 * 1000,
  circuitBreakerStart: 0,
  circuitBreakerUntil: 0,
  cache: new Map(),
}

Object.defineProperty(linuxdoThrottleState, 'isCircuitBreaking', {
  get() {
    return Date.now() < this.circuitBreakerUntil
  },
  configurable: true,
  enumerable: true,
})

let linuxdoExecutionQueue = Promise.resolve()

export function resetLinuxDoThrottle(overrides = {}) {
  linuxdoThrottleState.lastRequestTime = 0
  linuxdoThrottleState.minIntervalMs = overrides.minIntervalMs ?? 2500
  linuxdoThrottleState.cacheTtlMs = overrides.cacheTtlMs ?? 3 * 60 * 1000
  linuxdoThrottleState.maxCacheSize = overrides.maxCacheSize ?? 100
  linuxdoThrottleState.cooldownMs = overrides.cooldownMs ?? 60 * 1000
  linuxdoThrottleState.circuitBreakerStart = 0
  linuxdoThrottleState.circuitBreakerUntil = 0
  linuxdoThrottleState.cache.clear()
  linuxdoExecutionQueue = Promise.resolve()
}

export function getLinuxDoCache(query, limit) {
  const key = `${String(query ?? '').trim()}:::${Number(limit) || 10}`
  const entry = linuxdoThrottleState.cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.time > linuxdoThrottleState.cacheTtlMs) {
    linuxdoThrottleState.cache.delete(key)
    return null
  }
  // LRU: 刷新至 Map 末尾
  linuxdoThrottleState.cache.delete(key)
  linuxdoThrottleState.cache.set(key, entry)
  return entry.items.map((it) => ({ ...it }))
}

export function setLinuxDoCache(query, limit, items) {
  if (!Array.isArray(items) || !items.length) return
  const key = `${String(query ?? '').trim()}:::${Number(limit) || 10}`
  if (linuxdoThrottleState.cache.has(key)) {
    linuxdoThrottleState.cache.delete(key)
  } else if (linuxdoThrottleState.cache.size >= linuxdoThrottleState.maxCacheSize) {
    const oldestKey = linuxdoThrottleState.cache.keys().next().value
    linuxdoThrottleState.cache.delete(oldestKey)
  }
  linuxdoThrottleState.cache.set(key, {
    time: Date.now(),
    items: items.map((it) => ({ ...it })),
  })
}

function checkLinuxDoCircuitBreaker() {
  if (Date.now() < linuxdoThrottleState.circuitBreakerUntil) {
    const remainingSec = Math.max(1, Math.ceil((linuxdoThrottleState.circuitBreakerUntil - Date.now()) / 1000))
    throw new Error(`linuxdo: 触发 429 频控保护，正在冷却避让中（剩余 ${remainingSec}s），自动跳过本次网络请求`)
  }
}

function is429Error(err) {
  if (!err) return false
  const str = `${err.message || ''} ${err.stderr || ''} ${err.stdout || ''}`
  return /429|Too Many Requests/i.test(str) || err.status === 429 || err.statusCode === 429
}

async function throttleLinuxDo(fn) {
  const next = linuxdoExecutionQueue.then(async () => {
    const now = Date.now()
    const elapsed = now - linuxdoThrottleState.lastRequestTime
    if (linuxdoThrottleState.lastRequestTime > 0 && elapsed < linuxdoThrottleState.minIntervalMs) {
      const delay = linuxdoThrottleState.minIntervalMs - elapsed
      await new Promise((r) => setTimeout(r, delay))
    }
    try {
      return await fn()
    } finally {
      linuxdoThrottleState.lastRequestTime = Date.now()
    }
  })
  linuxdoExecutionQueue = next.catch(() => {})
  return next
}

export const BACKENDS = {
  github: {
    label: 'GitHub',
    kind: 'code',
    build: (query, n) => ({ file: 'gh', args: ['search', 'repos', query, '--sort', 'stars', '--limit', String(n), '--json', 'fullName,description,stargazersCount,createdAt,url'] }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform).map((x) => ({ ...x, note: x.note })),
  },
  web: {
    label: 'Web (Tavily/Exa)',
    kind: 'web',
    build: (query, n) => shimRun(
      'mcporter',
      `call "exa.web_search_exa(query: '${psq(query)}', numResults: ${n})" --output json`,
      ['call', `exa.web_search_exa(query: "${query}", numResults: ${n})`, '--output', 'json'],
    ),
    customRun: async (query, n) => {
      // 1) 优先：走 Tavily 高速搜索
      const { key: tavilyKey, endpoint: tavilyEndpoint } = getTavilyWebConfig()
      if (tavilyKey) {
        try {
          const res = await fetch(tavilyEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tavilyKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, max_results: n }),
          })
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data.results) && data.results.length > 0) {
              return data.results.map((r) => ({
                platform: 'web',
                title: r.title || '',
                url: r.url || '',
                note: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
              }))
            }
          }
        } catch (_) {}
      }
      // 2) 备用：降级 Exa (mcporter) —— 跨平台 shimRun
      const out = await run(BACKENDS.web.build(query, n))
      const parsed = tryJson(out)
      const blocks = []
      const collect = (o) => {
        if (Array.isArray(o)) o.forEach(collect)
        else if (o && typeof o === 'object') {
          if (o.type === 'text' && typeof o.text === 'string') blocks.push(o.text)
          else for (const v of Object.values(o)) collect(v)
        }
      }
      collect(parsed)
      const items = []
      for (const block of blocks) {
        const parts = String(block).split(/^Title:\s*/m).slice(1)
        for (const p of parts) {
          const title = String(p.split('\n')[0] ?? '').trim()
          const url = (p.match(/^URL:\s*(\S+)/m) || [])[1] ?? ''
          const note = (p.match(/^Highlights:([\s\S]*)$/m) || [])[1]
          items.push({ platform: 'web', title, url, note: String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) })
        }
      }
      return items.filter((x) => x.title || x.url)
    },
    parse: (out, platform) => {
      const parsed = tryJson(out)
      const blocks = []
      const collect = (o) => {
        if (Array.isArray(o)) o.forEach(collect)
        else if (o && typeof o === 'object') {
          if (o.type === 'text' && typeof o.text === 'string') blocks.push(o.text)
          else for (const v of Object.values(o)) collect(v)
        }
      }
      collect(parsed)
      const items = []
      for (const block of blocks) {
        const parts = String(block).split(/^Title:\s*/m).slice(1)
        for (const p of parts) {
          const title = String(p.split('\n')[0] ?? '').trim()
          const url = (p.match(/^URL:\s*(\S+)/m) || [])[1] ?? ''
          const note = (p.match(/^Highlights:([\s\S]*)$/m) || [])[1]
          items.push({ platform, title, url, note: String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) })
        }
      }
      return items.filter((x) => x.title || x.url)
    },
  },
  twitter: {
    label: 'Twitter',
    kind: 'social',
    build: (query, n) => shimRun(
      'opencli',
      `twitter search '${psq(query)}' --limit ${n} -f json`,
      ['twitter', 'search', query, '--limit', String(n), '-f', 'json'],
    ),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  reddit: {
    label: 'Reddit',
    kind: 'social',
    build: (query, n) => shimRun(
      'opencli',
      `reddit search '${psq(query)}' --limit ${n} -f json`,
      ['reddit', 'search', query, '--limit', String(n), '-f', 'json'],
    ),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  xiaohongshu: {
    label: '小红书',
    kind: 'social',
    build: (query, n) => shimRun(
      'opencli',
      `xiaohongshu search '${psq(query)}' --limit ${n} -f json`,
      ['xiaohongshu', 'search', query, '--limit', String(n), '-f', 'json'],
    ),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  youtube: {
    label: 'YouTube',
    kind: 'video',
    build: (query, n) => ({ file: 'yt-dlp', args: [`ytsearch${n}:${query}`, '--dump-json', '--no-warnings', '--skip-download'] }),
    parse: (out, platform) => {
      const rows = []
      for (const line of String(out).split('\n')) {
        const t = line.trim()
        if (!t.startsWith('{')) continue
        try {
          const j = JSON.parse(t)
          rows.push({ platform, title: j.title ?? j.id ?? '', url: j.webpage_url ?? j.url ?? '', note: j.channel ?? '' })
        } catch { /* skip malformed ndjson line */ }
      }
      return rows.filter((x) => x.title || x.url)
    },
  },

  bilibili: {
    label: 'B站',
    kind: 'video',
    build: (query, n) => ({ file: 'bili', args: ['search', query, '--type', 'video', '-n', String(n), '--json'] }),
    parse: (out, platform) => {
      const parsed = tryJson(out)
      const arr = Array.isArray(parsed) ? parsed : (parsed && parsed.data)
      if (!Array.isArray(arr)) return []
      return arr.slice(0, 30).map((it) => {
        const o = it && typeof it === 'object' ? it : {}
        const bvid = o.bvid ?? o.id ?? ''
        return {
          platform,
          title: String(o.title ?? ''),
          url: bvid ? `https://www.bilibili.com/video/${bvid}` : '',
          note: [`UP:${o.author ?? ''}`, o.play ? `${o.play}播放` : ''].filter(Boolean).join(' · '),
        }
      }).filter((x) => x.title || x.url)
    },
  },

  v2ex: {
    label: 'V2EX',
    kind: 'social',
    fetchUrl: () => 'https://www.v2ex.com/api/topics/hot.json',
    parse: (out, platform, query, limit) => {
      const arr = tryJson(out)
      if (!Array.isArray(arr)) return []
      const toks = String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1)
      let items = arr.map((o) => ({ platform, title: o.title ?? '', url: o.url ?? '', note: o.node?.title ?? '' }))
      if (toks.length) {
        const hit = items.filter((x) => toks.some((t) => String(x.title).toLowerCase().includes(t)))
        if (hit.length) items = hit
        // V2EX 公开 API 无关键词搜索；过滤不到就回退热帖原文，避免空结果
      }
      return items.slice(0, limit).filter((x) => x.title || x.url)
    },
  },

  linkedin: {
    label: 'LinkedIn',
    kind: 'social',
    build: (query, n) => shimRun(
      'mcporter',
      `call "linkedin-scraper.search_people(keyword: '${psq(query)}', limit: ${n})" --output json`,
      ['call', `linkedin-scraper.search_people(keyword: "${query}", limit: ${n})`, '--output', 'json'],
    ),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },

  telegram: {
    label: 'Telegram',
    kind: 'social',
    probe: probeTelegram,
    build: (query, n) => ({
      file: getTelegramPython(),
      args: ['-c', TG_SCRIPT, query, String(n)],
    }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },

  linuxdo: {
    label: 'LINUX DO',
    kind: 'social',
    probe: probeLinuxDo,
    build: (query, n) => ({
      file: getLinuxDoPython(),
      args: ['-c', LINUXDO_SCRIPT, query, String(n)],
    }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
    customRun: async (query, n) => {
      // 1. 检查 429 熔断冷却窗口
      checkLinuxDoCircuitBreaker()

      // 2. 检查内存短时缓存 (TTL Cache)
      const cached = getLinuxDoCache(query, n)
      if (cached) return cached

      // 3. 节流串行排队与真实网络请求
      return await throttleLinuxDo(async () => {
        // 进入临界区后二次检查熔断与缓存
        checkLinuxDoCircuitBreaker()
        const secondCached = getLinuxDoCache(query, n)
        if (secondCached) return secondCached

        let out
        try {
          out = await run(BACKENDS.linuxdo.build(query, n))
        } catch (err) {
          if (is429Error(err)) {
            linuxdoThrottleState.circuitBreakerStart = Date.now()
            linuxdoThrottleState.circuitBreakerUntil = Date.now() + linuxdoThrottleState.cooldownMs
            const remainingSec = Math.max(1, Math.ceil(linuxdoThrottleState.cooldownMs / 1000))
            console.warn(`[harvest:linuxdo] 捕获到 429 异常，开启 ${remainingSec}s 熔断冷却保护`)
            throw new Error(`linuxdo: 触发 429 频控保护，正在冷却避让中（剩余 ${remainingSec}s），自动跳过本次网络请求`)
          }
          throw err
        }

        const items = BACKENDS.linuxdo.parse(out, 'linuxdo', query, n)
        if (!items || !items.length) {
          throw new Error('linuxdo: empty result')
        }
        setLinuxDoCache(query, n, items)
        return items
      })
    },
  },
}

// 运行单个通道；成功返回 items[]，失败抛错（含通道名，便于记 skip）。
export async function scoutChannel(id, query, limit) {
  let b = BACKENDS[id]
  if (!b) {
    const domainMap = { zhihu: 'zhihu.com', weibo: 'weibo.com', douyin: 'douyin.com' }
    if (domainMap[id]) {
      const siteQuery = `${query} site:${domainMap[id]}`
      return BACKENDS.web.customRun(siteQuery, limit)
    } else if (id.includes('.')) {
      const siteQuery = `${query} site:${id}`
      return BACKENDS.web.customRun(siteQuery, limit)
    }
    throw new Error(`unknown platform: ${id}`)
  }
  // 特殊通道前置检查（如 linuxdo 熔断与缓存）：避免在熔断期或命中缓存时白跑 probe
  if (id === 'linuxdo') {
    checkLinuxDoCircuitBreaker()
    const cached = getLinuxDoCache(query, limit)
    if (cached) return cached
  }
  if (typeof b.probe === 'function' && !b.probe()) {
    throw new Error(`${id}: probe failed (environment not configured or session/cookie missing)`)
  }
  if (b.customRun) {
    const items = await b.customRun(query, limit)
    if (!items.length) throw new Error(`${id}: empty result`)
    return items
  }
  let out
  if (b.fetchUrl) {
    const res = await httpGetText(b.fetchUrl(query, limit), { headers: { 'user-agent': 'agent-reach/1.0' } })
    if (res.status < 200 || res.status >= 300) throw new Error(`${id}: HTTP ${res.status}`)
    out = res.text
  } else {
    out = await run(b.build(query, limit))
  }
  const items = b.parse(out, id, query, limit)
  if (!items.length) throw new Error(`${id}: empty result`)
  return items
}
