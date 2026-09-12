import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { command, runCommand } from '../lib/process.js'

test('Windows shim round-trips special query characters as literal data', {skip:process.platform!=='win32'}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'harvest-argv-'))
  const old=process.env.HARVEST_BIN
  const file=path.join(dir,'harvest-echo.ps1')
  t.after(async()=>{
    if(old===undefined) delete process.env.HARVEST_BIN; else process.env.HARVEST_BIN=old
    await fs.unlink(file);await fs.rmdir(dir)
  })
  await fs.writeFile(file,'[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ConvertTo-Json -InputObject @($args) -Compress','utf8')
  process.env.HARVEST_BIN=dir
  const args=['中文 query', "single'quote", 'double"quote', '$env:USERNAME $(Write-Output INJECTED)', 'a`nb', 'line\nnext', '{"query":"quoted"}']
  const stdout=await runCommand(command('harvest-echo',args))
  assert.deepEqual(JSON.parse(stdout.replace(/^\uFEFF/,'')),args)
})
