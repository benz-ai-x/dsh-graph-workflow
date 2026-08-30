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
check(
  JSON.stringify(plugin.inject) === JSON.stringify(['tools', 'skills', 'llm', 'agents', 'workspaceRegistry']),
  'built plugin lost its exact service injection contract',
)
check(typeof plugin.Config === 'function', 'built plugin lost its runtime Config schema')
check(typeof plugin.apply === 'function', 'built plugin lost its apply function')
check(typeof plugin.GraphWorkflowStore === 'function', 'built plugin lost its durable store export')
check(manifest.private === true, 'built source-linked package is not private')
check(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-primitives'] === '0.1.2-alpha.1', 'package lost its UI primitives peer contract')
check(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-primitives') === true, 'Client loader does not inject UI primitives')

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
check(client.includes('sidebar.workspace.section'), 'Client bundle lost the Workspace resource-section contribution')
check(client.includes('pluginCss'), 'Client bundle lost scoped CSS injection')
check(clientHandoff?.id === 'dsh-graph-workflow' && typeof clientHandoff?.factory === 'function', 'Client bundle did not register a lazy factory when evaluated')
check(remoteTypes.includes("'graphWorkflows/start'"), 'generated Remote declarations lost start')
check(remoteTypes.includes("'graphWorkflows/runs'"), 'generated Remote declarations lost live run polling')
check(remoteTypes.includes("'graphWorkflows/publish'"), 'generated Remote declarations lost publication')
check(remoteTypes.includes("'graphWorkflows/restore'"), 'generated Remote declarations lost rollback')
check(remoteTypes.includes("'graphWorkflows/capabilities'"), 'generated Remote declarations lost capability selectors')
check(remoteTypes.includes("'graphWorkflows/saveTestCase'"), 'generated Remote declarations lost regression cases')
check(remoteTypes.includes('agentId: SessionId'), 'generated Remote declarations lost Agent authority lookup')
check(remoteTypes.includes('GraphWorkflowWorkspaceRequest'), 'generated Remote declarations lost Workspace-scoped catalog lookup')
check(publicTypes.includes("export type * from './domain"), 'browser-safe public type outlet is not wired to the domain vocabulary')
check(domainTypes.includes('GraphWorkflowDefinition'), 'browser-safe domain declarations lost GraphWorkflowDefinition')
check(domainTypes.includes('readonly workspaceId: string'), 'browser-safe domain declarations lost stable Workspace ownership')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}

console.log(`built package smoke passed: ${manifest.name} (Host ${host.length} bytes, Client ${client.length} bytes)`)
