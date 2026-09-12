import os from 'node:os'
import path from 'node:path'

export function getConfig(overrides = {}, env = process.env) {
  return {
    key: env.TAVILY_API_KEY || overrides.key,
    endpoint: env.TAVILY_ENDPOINT || overrides.endpoint || 'https://api.tavily.com/search',
    researchEndpoint: env.TAVILY_RESEARCH_ENDPOINT || overrides.researchEndpoint || 'https://api.tavily.com/research',
    dataDir: env.HARVEST_DATA_DIR || overrides.dataDir || path.join(os.homedir(), '.harvest'),
  }
}

export function httpUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Expected an HTTP(S) URL without embedded credentials')
  }
  return url.href
}

export function publicError(error, key) {
  let message = String(error?.message || error)
  if (key) message = message.split(key).join('[REDACTED]')
  return message.slice(0, 1000)
}
