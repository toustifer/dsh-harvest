import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execFile)
const quote = value => `'${String(value).replace(/'/g, "''")}'`

export function resolveCommand(name) {
  const dirs = [process.env.HARVEST_BIN, process.env.DSH_HARVEST_BIN,
    ...(process.env.PATH || '').split(path.delimiter),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), path.join(os.homedir(), '.npm-global')].filter(Boolean)
  const extensions = process.platform === 'win32' ? ['.exe', '.ps1', '.cmd', ''] : ['']
  for (const dir of dirs) for (const extension of extensions) {
    const candidate = path.join(dir, name + extension)
    try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
  }
  return null
}

export function command(name, args) {
  if (process.platform !== 'win32') return { file: name, args }
  const file = resolveCommand(name) || name
  if (/\.ps1$/i.test(file)) {
    // Each argument is a literal, never a PowerShell expression.
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(file)} ${args.map(quote).join(' ')}`] }
  }
  if (/\.cmd$/i.test(file)) throw new Error(`${name}: .cmd-only installation; a .ps1 shim or native executable is required`)
  return { file, args }
}

export async function runCommand(spec, { signal, timeoutMs = 20000 } = {}) {
  const { stdout } = await exec(spec.file, spec.args, {
    signal, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  })
  return stdout
}
