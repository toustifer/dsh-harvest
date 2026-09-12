import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../',import.meta.url))
const output = path.join(root,'dist','dsh-harvest')
await fs.mkdir(path.join(output,'bin'),{recursive:true})
await build({entryPoints:[path.join(root,'bin','harvest-mcp.mjs')],outfile:path.join(output,'bin','harvest-mcp.mjs'),
  bundle:true,platform:'node',format:'esm',target:'node22',
  banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},legalComments:'eof'})
for (const file of ['.codex-plugin','.mcp.json','skills','LICENSE','ATTRIBUTION.md']) {
  await fs.cp(path.join(root,file),path.join(output,file),{recursive:true})
}
// Include dependency license texts with the self-contained runtime.
const licenses=[]
async function collect(dir) {
  for (const item of await fs.readdir(dir,{withFileTypes:true})) {
    if (!item.isDirectory() || item.name==='.bin') continue
    const packageDir=path.join(dir,item.name)
    if(item.name.startsWith('@')) {await collect(packageDir);continue}
    const files=await fs.readdir(packageDir)
    for (const file of files.filter(name=>/^licen[cs]e(?:\.|$)/i.test(name))) {
      const stat=await fs.stat(path.join(packageDir,file))
      if(stat.isFile()) licenses.push(`## ${path.relative(path.join(root,'node_modules'),packageDir)}\n\n${await fs.readFile(path.join(packageDir,file),'utf8')}`)
    }
  }
}
await collect(path.join(root,'node_modules'))
await fs.writeFile(path.join(output,'THIRD_PARTY_LICENSES.txt'),licenses.join('\n\n'))
await fs.writeFile(path.join(output,'README.md'),'# Harvest for Codex\n\nRequires Node.js 22+. This plugin includes its MCP dependencies. Install this folder as a local Codex plugin, or configure node bin/harvest-mcp.mjs with cwd set to this directory and install skills/harvest-research. Tavily is optional; provide TAVILY_API_KEY through the host environment.\n')
console.log(`Built standalone plugin: ${output}`)
