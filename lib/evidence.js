export function canonicalUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.href
  } catch { return null }
}

export function dedupeSources(sources) {
  const found = new Map()
  for (const source of sources) {
    const url = canonicalUrl(source.url)
    if (!url) continue
    const previous = found.get(url)
    if (!previous || (source.text || '').length > (previous.text || '').length) found.set(url, { ...source, url })
  }
  return [...found.values()]
}

function tokens(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}|[\p{Script=Han}]/gu) || [])]
}

export function collectEvidence(claims, sources) {
  const unique = dedupeSources(sources)
  return { method:'lexical_candidates_only', requiresSemanticReview:true,
    verdicts: claims.map(claim => {
      const words = tokens(claim)
      const candidates = unique.filter(s => s.text?.trim()).flatMap(s => {
        const lower = s.text.toLowerCase()
        const hits = words.filter(word => lower.includes(word))
        if (!hits.length) return []
        const start = Math.max(0, lower.indexOf(hits[0]) - 150)
        return [{ url:s.url, title:s.title, excerpt:s.text.slice(start, start + 1000), matchedTerms:hits.slice(0,20), relation:'undetermined' }]
      })
      return { claim, status:candidates.length ? 'needs_review' : 'insufficient_evidence', candidates:candidates.slice(0,5), totalCandidates:candidates.length, truncated:candidates.length>5 }
    }),
    excluded: sources.length - unique.length,
    note:'Keyword overlap does not establish support, contradiction, or source independence. Review original passages.' }
}

export function auditSources(sources) {
  return { matrix:sources.map(source => {
    const url = canonicalUrl(source.url)
    const parsedDate = source.publishedAt ? Date.parse(source.publishedAt) : NaN
    return { title:source.title, url, declaredType:source.type || 'unknown',
      hostname:url ? new URL(url).hostname : null,
      publishedAt:Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
      hasText:Boolean(source.text?.trim()),
      authority:'unknown', firsthand:'unknown', timeliness:'requires_context', bias:'unknown',
      verdict:'needs_review',
      checks:[...(!url ? ['missing_valid_url'] : []), ...(!source.text?.trim() ? ['original_text_missing'] : []),
        ...(!Number.isFinite(parsedDate) ? ['publication_date_unknown'] : []), 'review_author_and_source_independence'] }
  }), note:'Metadata is not a credibility score. A domain or supplied type cannot establish truth.' }
}
