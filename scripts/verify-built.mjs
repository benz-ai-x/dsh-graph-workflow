#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(root, 'packages/graph-workflow')
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
const requireFromPackage = createRequire(resolve(packageRoot, '__public-export-check.cjs'))
const publicEntry = requireFromPackage.resolve(manifest.name)
const plugin = await import(pathToFileURL(publicEntry).href)
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

check(publicEntry === resolve(packageRoot, 'lib/index.js'), `public export resolved to ${publicEntry}`)
check(!('default' in plugin), 'built namespace plugin unexpectedly has a default export')
check(plugin.name === 'graph-workflow', `built plugin name is ${JSON.stringify(plugin.name)}`)
check(JSON.stringify(plugin.inject) === JSON.stringify(['tools', 'workflowEngine', 'skills', 'agents']), 'built plugin lost its exact service injection contract')
check(typeof plugin.Config === 'function', 'built plugin lost its runtime Config schema')
check(typeof plugin.apply === 'function', 'built plugin lost its apply function')
check(typeof plugin.GraphWorkflowStore === 'function', 'built plugin lost its durable store export')
check(manifest.private === true, 'built source-linked package is not private')

const [host, client, remoteTypes, publicTypes, domainTypes] = await Promise.all([
  readFile(resolve(packageRoot, 'lib/index.js'), 'utf8'),
  readFile(resolve(packageRoot, 'lib/client.js'), 'utf8'),
  readFile(resolve(packageRoot, 'lib/typert.remote-client.d.ts'), 'utf8'),
  readFile(resolve(packageRoot, 'lib/types/types.d.ts'), 'utf8'),
  readFile(resolve(packageRoot, 'lib/types/domain.d.ts'), 'utf8'),
])
let clientHandoff
const previousWindow = globalThis.window
try {
  globalThis.window = { __ModuleLoader__: { load: handoff => { clientHandoff = handoff } } }
  await import(`${pathToFileURL(resolve(packageRoot, 'lib/client.js')).href}?verify=${String(Date.now())}`)
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}
check(host.length > 25_000, 'Host bundle is unexpectedly small (likely contains unresolved internal imports)')
check(!/from\s+["']\.\.?\//u.test(host), 'Host bundle retains a relative runtime import')
check(client.startsWith('window.__ModuleLoader__.load('), 'Client bundle is not a lazy ModuleLoader registration')
check(client.includes('dsh-graph-workflow'), 'Client bundle lost its stable module id')
check(client.includes('Graph Workflow'), 'Client bundle lost the visual studio surface')
check(client.includes('pluginCss'), 'Client bundle lost scoped CSS injection')
check(clientHandoff?.id === 'dsh-graph-workflow' && typeof clientHandoff?.factory === 'function', 'Client bundle did not register a lazy factory when evaluated')
check(remoteTypes.includes("'graphWorkflows/start'"), 'generated Remote declarations lost start')
check(remoteTypes.includes("'graphWorkflows/runs'"), 'generated Remote declarations lost live run polling')
check(remoteTypes.includes('agentId: SessionId'), 'generated Remote declarations lost Agent authority lookup')
check(publicTypes.includes("export type * from './domain"), 'browser-safe public type outlet is not wired to the domain vocabulary')
check(domainTypes.includes('GraphWorkflowDefinition'), 'browser-safe domain declarations lost GraphWorkflowDefinition')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}

console.log(`built package smoke passed: ${manifest.name} (Host ${host.length} bytes, Client ${client.length} bytes)`)
