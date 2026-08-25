// ============================================================================
// dsh-harvest —— 通道封装层（零依赖，自包含）
// 每个通道声明：如何拼命令、如何把 CLI 输出归一化成 { platform, title, url, note }。
// 任一通道失败（CLI 缺失 / 浏览器桥接未连 / 解析失败）一律抛错，由 index.js 捕获后
// 记入 skipped[]，绝不阻塞整条 scout。
// ============================================================================

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { httpGetText } from './http.js'

const execFileP = promisify(execFile)
const TIMEOUT = 90_000

// opencli / mcporter 是 .ps1/.cmd 垫片，Node execFile 无法直接执行(ENOENT/EINVAL)，
// 统一经 powershell.exe 以绝对路径调用。可用 DSH_HARVEST_BIN 覆盖垫片目录。
const SHIM_DIR = process.env.DSH_HARVEST_BIN || 'C:\\Users\\15775\\.npm-global'
function psq(s) { return String(s).replace(/'/g, "''") }
function psShim(name) { return `& '${psq(SHIM_DIR)}\\${name}.ps1'` }

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

// —— 通道声明表 ——
export const BACKENDS = {
  github: {
    label: 'GitHub',
    kind: 'code',
    build: (query, n) => ({ file: 'gh', args: ['search', 'repos', query, '--sort', 'stars', '--limit', String(n), '--json', 'fullName,description,stargazersCount,createdAt,url'] }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform).map((x) => ({ ...x, note: x.note })),
  },
  web: {
    label: 'Web/Exa',
    kind: 'web',
    build: (query, n) => ({ file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim('mcporter')} call "exa.web_search_exa(query: '${psq(query)}', numResults: ${n})" --output json`] }),
    parse: (out, platform) => {
      // mcporter --output json：结果挤在一个 text 块，格式 "Title: ...\nURL: ...\nHighlights: ..."，条目间以 "---" 分隔
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
    build: (query, n) => ({ file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim('opencli')} twitter search '${psq(query)}' --limit ${n} -f json`] }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  reddit: {
    label: 'Reddit',
    kind: 'social',
    build: (query, n) => ({ file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim('opencli')} reddit search '${psq(query)}' --limit ${n} -f json`] }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  xiaohongshu: {
    label: '小红书',
    kind: 'social',
    build: (query, n) => ({ file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim('opencli')} xiaohongshu search '${psq(query)}' --limit ${n} -f json`] }),
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
    build: (query, n) => ({ file: 'powershell.exe', args: ['-NoProfile', '-Command', `${psShim('mcporter')} call "linkedin-scraper.search_people(keyword: '${psq(query)}', limit: ${n})" --output json`] }),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
}

// 运行单个通道；成功返回 items[]，失败抛错（含通道名，便于记 skip）。
export async function scoutChannel(id, query, limit) {
  const b = BACKENDS[id]
  if (!b) throw new Error(`unknown platform: ${id}`)
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
