// ============================================================================
// dsh-harvest —— 通道封装层（零依赖，自包含）
// 每个通道声明：如何拼命令、如何把 CLI 输出归一化成 { platform, title, url, note }。
// 任一通道失败（CLI 缺失 / 浏览器桥接未连 / 解析失败）一律抛错，由 core.js 捕获后
// 记入 skipped[]，绝不阻塞整条 scout。
// ============================================================================

import { httpGetText, requestJson } from './http.js'
import { command, runCommand } from './process.js'
import { getConfig } from './config.js'

function q(s) { return String(s ?? '') }

// 宽容地取出 CLI 输出里第一个 JSON 值（数组或对象），解析失败返回 null。
function tryJson(raw) {
  const text = q(raw)
  const start = Math.min(
    ...[text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0)
  )
  if (start === Infinity || start < 0) throw new Error('Channel returned non-JSON output')
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
        try { return JSON.parse(text.slice(start, i + 1)) } catch { throw new Error('Channel returned invalid JSON') }
      }
    }
  }
  throw new Error('Channel returned incomplete JSON')
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
  if (!arr) throw new Error('Channel returned an unrecognized result shape')
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
    build: (query, n) => command('mcporter', ['call', 'exa.web_search_exa', '--args', JSON.stringify({query, numResults:n}), '--output', 'json']),
    customRun: async (query, n, options = {}) => {
      const config = options.config || getConfig()
      if (config.key) {
        try {
          const data = await requestJson(config.endpoint, {
            method: 'POST', signal: options.signal,
            headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, max_results: n }),
          })
          if (!Array.isArray(data.results)) throw new Error('Invalid search results')
          return data.results.map(r => ({ platform:'web', title:r.title || '', url:r.url || '', note:String(r.content || '').slice(0, 1000) }))
        } catch (error) {
          if (options.signal?.aborted) throw error
          options.warnings?.push({ platform:'web', provider:'tavily', reason:String(error.message) })
        }
      }
      return BACKENDS.web.parse(await runCommand(BACKENDS.web.build(query, n), options), 'web')
    },
    parse: (out, platform) => {
      const parsed = tryJson(out)
      if (Array.isArray(parsed) || Array.isArray(parsed?.results) || Array.isArray(parsed?.items)) return normalizeItems(parsed,platform)
      const blocks = []
      const collect = (o) => {
        if (Array.isArray(o)) o.forEach(collect)
        else if (o && typeof o === 'object') {
          if (o.type === 'text' && typeof o.text === 'string') blocks.push(o.text)
          else for (const v of Object.values(o)) collect(v)
        }
      }
      collect(parsed)
      if (!blocks.length) throw new Error('Exa response has no recognized results or text blocks')
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
    build: (query, n) => command('opencli', ['twitter', 'search', query, '--limit', String(n), '-f', 'json']),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  reddit: {
    label: 'Reddit',
    kind: 'social',
    build: (query, n) => command('opencli', ['reddit', 'search', query, '--limit', String(n), '-f', 'json']),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
  xiaohongshu: {
    label: '小红书',
    kind: 'social',
    build: (query, n) => command('opencli', ['xiaohongshu', 'search', query, '--limit', String(n), '-f', 'json']),
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
      if (!Array.isArray(arr)) throw new Error('Bilibili returned an unrecognized result shape')
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
      if (!Array.isArray(arr)) throw new Error('V2EX returned an unrecognized result shape')
      const toks = String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1)
      let items = arr.map((o) => ({ platform, title: o.title ?? '', url: o.url ?? '', note: o.node?.title ?? '' }))
      if (toks.length) {
        const hit = items.filter((x) => toks.some((t) => String(x.title).toLowerCase().includes(t)))
        items = hit
        // No unrelated hot-topic fallback: zero matches is a legitimate empty result.
      }
      return items.slice(0, limit).filter((x) => x.title || x.url)
    },
  },

  linkedin: {
    label: 'LinkedIn',
    kind: 'social',
    build: (query, n) => command('mcporter', ['call', 'linkedin-scraper.search_people', '--args', JSON.stringify({keyword:query, limit:n}), '--output', 'json']),
    parse: (out, platform) => normalizeItems(tryJson(out), platform),
  },
}

// 运行单个通道；成功返回 items[]，失败抛错（含通道名，便于记 skip）。
export async function scoutChannel(id, query, limit, options = {}) {
  const b = BACKENDS[id]
  if (!b) throw new Error(`unknown platform: ${id}`)
  if (b.customRun) {
    const items = await b.customRun(query, limit, options)
    return items
  }
  let out
  if (b.fetchUrl) {
    const res = await httpGetText(b.fetchUrl(query, limit), { ...options, headers: { 'user-agent': 'harvest/0.3' } })
    if (res.status < 200 || res.status >= 300) throw new Error(`${id}: HTTP ${res.status}`)
    out = res.text
  } else {
    out = await runCommand(b.build(query, limit), options)
  }
  const items = b.parse(out, id, query, limit)
  return items
}
