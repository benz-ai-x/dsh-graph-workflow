#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireSource = process.argv.includes('--require-source')
const syncLinks = process.argv.includes('--sync-links')
const harnessRootIndex = process.argv.indexOf('--harness-root')
const explicitHarnessRoot = harnessRootIndex >= 0 ? process.argv[harnessRootIndex + 1] : undefined
const failures = []
const warnings = []
const passes = []
const expectedLinks = Object.freeze({
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/cordis-plugin-include': 'vendor/include',
  '@deepseek-ai/cordis-plugin-loader': 'vendor/loader',
  '@deepseek-ai/dsh-agent': 'packages/core/agent',
  '@deepseek-ai/dsh-api-gateway': 'packages/api/gateway',
  '@deepseek-ai/dsh-api-remotes': 'packages/api/remotes',
  '@deepseek-ai/dsh-api-session-controller': 'packages/api/session-controller',
  '@deepseek-ai/dsh-client-locale': 'packages/client/locale',
  '@deepseek-ai/dsh-client-test-runtime': 'packages/test-support/client-runtime',
  '@deepseek-ai/dsh-client-ui-primitives': 'packages/client/ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer': 'packages/client/ui-renderer',
  '@deepseek-ai/dsh-client-ui-session': 'packages/client/ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar': 'packages/client/ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots': 'packages/client/ui-slots',
  '@deepseek-ai/dsh-client-ui-workspace': 'packages/client/ui-workspace',
  '@deepseek-ai/dsh-llm': 'packages/llm/llm',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-skill': 'packages/skill/skill',
  '@deepseek-ai/dsh-system-prompt': 'packages/core/system-prompt',
  '@deepseek-ai/dsh-tools': 'packages/core/tools',
  '@deepseek-ai/dsh-typert-generator': 'packages/typert/generator',
  '@deepseek-ai/dsh-typert-protocol': 'packages/typert/protocol',
  '@deepseek-ai/dsh-typert-registry': 'packages/typert/registry',
  '@deepseek-ai/dsh-workflow': 'packages/workflow/workflow',
  '@deepseek-ai/dsh-workspace': 'packages/workspace/workspace',
})
const packageRoot = join(projectRoot, 'packages/graph-workflow')
const packageManifestPath = join(packageRoot, 'package.json')

function check(condition, message) {
  if (condition) passes.push(message)
  else failures.push(message)
}

function listFiles(root) {
  const result = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) result.push(absolute)
    }
  }
  visit(root)
  return result.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
}

function digestDocs(sourceRoot) {
  const docsRoot = join(sourceRoot, 'docs')
  if (!existsSync(docsRoot) || !statSync(docsRoot).isDirectory()) {
    throw new Error(`missing docs directory under ${sourceRoot}`)
  }
  const aggregate = createHash('sha256')
  for (const absolute of listFiles(docsRoot)) {
    const fileDigest = createHash('sha256').update(readFileSync(absolute)).digest('hex')
    const sourceRelative = relative(sourceRoot, absolute).split(sep).join('/')
    aggregate.update(`${fileDigest}  ${sourceRelative}\n`)
  }
  return aggregate.digest('hex')
}

function gitHead(sourceRoot) {
  const result = spawnSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git rev-parse failed for ${sourceRoot}`)
  }
  return result.stdout.trim()
}

function gitDiff(sourceRoot, paths) {
  const result = spawnSync('git', [
    '-C', sourceRoot, 'diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', '--', ...paths,
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git diff failed for ${sourceRoot}`)
  }
  return result.stdout
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function applyOverlay(sourceRoot, patch) {
  const checkResult = spawnSync('git', ['-C', sourceRoot, 'apply', '--check', '--whitespace=nowarn', '-'], {
    encoding: 'utf8',
    input: patch,
  })
  if (checkResult.status !== 0) {
    throw new Error(checkResult.stderr.trim() || `overlay preflight failed for ${sourceRoot}`)
  }
  const result = spawnSync('git', ['-C', sourceRoot, 'apply', '--whitespace=nowarn', '-'], {
    encoding: 'utf8',
    input: patch,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `overlay apply failed for ${sourceRoot}`)
  }
}

function rebuildOverlayPackage(sourceRoot) {
  const commands = [
    ['exec', 'tsc', '-b', 'packages/client/ui-workspace/tsconfig.json', '--force'],
    ['--filter', '@deepseek-ai/dsh-client-ui-workspace', 'bundle'],
  ]
  for (const args of commands) {
    const result = spawnSync('pnpm', ['--dir', sourceRoot, ...args], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error(`pnpm ${args.join(' ')} failed while rebuilding the Harness overlay`)
    }
  }
}

function harnessWorktreeChanges(sourceRoot) {
  const statusCommands = [
    ['status', '--porcelain=v1', '--untracked-files=all'],
    ['status', '--porcelain=v1', '--ignored=matching', '--untracked-files=all', '--', '.env'],
  ]
  const changes = new Set()
  for (const args of statusCommands) {
    const result = spawnSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `git status failed for ${sourceRoot}`)
    }
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line) changes.add(line)
    }
  }
  return [...changes].join('\n')
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(value)
  return match ? match.slice(1).map(Number) : undefined
}

function nodeSatisfies(range, version = process.version) {
  const actual = parseVersion(version)
  if (!actual || typeof range !== 'string') return false
  return range.split('||').some(rawClause => {
    const clause = rawClause.trim()
    const minimum = parseVersion(clause.replace(/^(?:\^|>=)\s*/, ''))
    if (!minimum || compareVersions(actual, minimum) < 0) return false
    if (clause.startsWith('>=')) return true
    if (clause.startsWith('^')) return compareVersions(actual, [minimum[0] + 1, 0, 0]) < 0
    return compareVersions(actual, minimum) === 0
  })
}

function relativePath(from, target) {
  let value = relative(from, target).split(sep).join('/')
  if (!value.startsWith('.')) value = `./${value}`
  return value
}

function writeJsonAtomically(path, value) {
  const temporary = `${path}.dsh-context-${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

function validateLinkedArtifacts(sourceRoot) {
  for (const [packageName, sourcePath] of Object.entries(expectedLinks)) {
    const packageRoot = join(sourceRoot, sourcePath)
    const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const entries = [
      ['main', packageManifest.main],
      ['types', packageManifest.types],
    ]
    const inputs = [join(packageRoot, 'package.json')]
    const sourceDirectory = join(packageRoot, 'src')
    if (existsSync(sourceDirectory)) inputs.push(...listFiles(sourceDirectory))
    const newestInput = Math.max(...inputs.map(path => statSync(path).mtimeMs))
    for (const [field, entry] of entries) {
      const artifact = typeof entry === 'string' ? join(packageRoot, entry) : undefined
      check(artifact !== undefined && existsSync(artifact), `${packageName} has a built ${field} entry`)
      if (artifact !== undefined && existsSync(artifact)) {
        check(statSync(artifact).mtimeMs >= newestInput, `${packageName} built ${field} entry is fresh`)
      }
    }
  }
}

const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'TODO.md',
  'package.json',
  'dsh-reference.lock.json',
  'docs/agent/PROJECT_CONTRACT.md',
  'pnpm-workspace.yaml',
  'packages/graph-workflow/package.json',
  'packages/graph-workflow/src/index.ts',
  'packages/graph-workflow/src/client/index.ts',
  'packages/graph-workflow/cordis.patch.yml',
  'packages/graph-workflow/tests/plugin.spec.ts',
  'packages/graph-workflow/tests/loader.spec.ts',
  'packages/graph-workflow/tests/fixtures/cordis.yml',
  'overlays/deepseek-harness/workspace-resource-slot.patch',
  'scripts/verify-built.mjs',
]
for (const path of requiredFiles) {
  check(existsSync(join(projectRoot, path)), `${path} exists`)
}

let manifest
let packageManifest
let lock
try {
  manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
} catch (error) {
  failures.push(`package.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
try {
  packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'))
} catch (error) {
  failures.push(`packages/graph-workflow/package.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
try {
  lock = JSON.parse(readFileSync(join(projectRoot, 'dsh-reference.lock.json'), 'utf8'))
} catch (error) {
  failures.push(`dsh-reference.lock.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (manifest) {
  check(manifest.name === 'dsh-graph-workflow-workspace', 'workspace package name matches the source contract')
  check(manifest.private === true, 'workspace remains private')
  check(manifest.type === 'module', 'workspace uses ESM')
  check(manifest.engines?.node === '^22.19.0 || >=24.0.0', 'workspace Node engine matches the pinned Harness')
  check(
    manifest.scripts?.['context:check:strict'] === 'node scripts/verify-dsh-context.mjs --require-source',
    'strict context script requires the source baseline',
  )
  check(
    manifest.scripts?.['context:sync'] === 'node scripts/verify-dsh-context.mjs --sync-links --require-source && pnpm install --no-frozen-lockfile',
    'context sync script rewrites links and refreshes the package-manager lock',
  )
  const serialized = JSON.stringify(manifest)
  check(!serialized.includes('workspace:'), 'workspace manifest contains no workspace protocol dependency')
}

if (packageManifest) {
  check(packageManifest.name === 'dsh-graph-workflow', 'plugin package name matches the product contract')
  check(packageManifest.private === true, 'source-linked plugin package remains private')
  check(packageManifest.type === 'module', 'plugin package uses ESM')
  check(packageManifest.engines?.node === '^22.19.0 || >=24.0.0', 'plugin Node engine matches the pinned Harness')
  check(packageManifest.dsh?.bundle?.patch === './cordis.patch.yml', 'plugin declares its DSH bundle patch')
  check(packageManifest.exports?.['./cordis.patch.yml'] === './cordis.patch.yml', 'plugin exports its bundle patch')
  check(packageManifest.exports?.['./client']?.default === './lib/client.js', 'plugin exports its Client bundle')
  check(packageManifest.exports?.['./types']?.types === './lib/types/types.d.ts', 'plugin exports its browser-safe contract')
  check(!JSON.stringify(packageManifest).includes('workspace:'), 'plugin package contains no workspace protocol dependency')
}

if (lock) {
  check(lock.schemaVersion === 2, 'reference lock schema is supported')
  check(/^[0-9a-f]{40}$/.test(lock.upstream?.commit ?? ''), 'reference lock has a full Git commit')
  check(/^[0-9a-f]{64}$/.test(lock.upstream?.docsDigest ?? ''), 'reference lock has a docs SHA-256')
  check(lock.upstream?.node === '^22.19.0 || >=24.0.0', 'reference lock records the pinned Node engine')
  check(nodeSatisfies(lock.upstream?.node), `Node ${process.version} satisfies ${lock.upstream?.node}`)
  check(lock.overlay?.baseCommit === lock.upstream?.commit, 'Harness overlay is pinned to the audited base commit')
  check(/^[0-9a-f]{64}$/.test(lock.overlay?.sha256 ?? ''), 'Harness overlay has a SHA-256')

  const environmentName = lock.localResolution?.environmentVariable ?? 'DSH_HARNESS_ROOT'
  const configuredRoot = explicitHarnessRoot || process.env[environmentName]
  const fallback = lock.localResolution?.fallbackRelativePath
  const sourceRoot = resolve(configuredRoot || join(projectRoot, fallback || ''))

  if (!existsSync(sourceRoot)) {
    const message = `pinned DSH source not found at ${sourceRoot}`
    if (requireSource) failures.push(message)
    else warnings.push(`${message}; set ${environmentName} for strict validation`)
  } else {
    try {
      const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
      check(sourceManifest.version === lock.upstream.version, `DSH version matches ${lock.upstream.version}`)
      check(sourceManifest.engines?.node === lock.upstream.node, `DSH Node engine matches ${lock.upstream.node}`)
      check(gitHead(sourceRoot) === lock.upstream.commit, `DSH commit matches ${lock.upstream.commit}`)
      check(digestDocs(sourceRoot) === lock.upstream.docsDigest, 'DSH docs digest matches the audited baseline')

      const overlayPath = resolve(projectRoot, lock.overlay?.patch ?? '')
      const overlayPaths = Array.isArray(lock.overlay?.paths) ? lock.overlay.paths : []
      const overlayFileIsValid = overlayPath.startsWith(`${projectRoot}${sep}`)
        && existsSync(overlayPath)
        && statSync(overlayPath).isFile()
      check(
        overlayFileIsValid,
        'Harness overlay patch exists inside the plugin workspace',
      )
      const overlayPathsAreValid = overlayPaths.length > 0
        && new Set(overlayPaths).size === overlayPaths.length
        && overlayPaths.every(path => typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'))
      check(
        overlayPathsAreValid,
        'Harness overlay declares bounded relative paths',
      )

      let overlayPatch = ''
      if (overlayFileIsValid) {
        overlayPatch = readFileSync(overlayPath, 'utf8')
        check(sha256(overlayPath) === lock.overlay?.sha256, 'Harness overlay patch digest matches the lock')
      }

      let dirty = harnessWorktreeChanges(sourceRoot)
      let appliedOverlay = false
      if (syncLinks && dirty.length === 0 && overlayPatch.length > 0 && failures.length === 0) {
        applyOverlay(sourceRoot, overlayPatch)
        dirty = harnessWorktreeChanges(sourceRoot)
        appliedOverlay = true
        passes.push('applied the audited Workspace resource-slot overlay')
      }

      const expectedChanges = overlayPaths.map(path => ` M ${path}`).sort()
      const actualChanges = dirty.length === 0 ? [] : dirty.split('\n').sort()
      const exactStatus = JSON.stringify(actualChanges) === JSON.stringify(expectedChanges)
      const exactDiff = overlayPathsAreValid && overlayPatch.length > 0
        && gitDiff(sourceRoot, overlayPaths) === overlayPatch
      check(exactStatus && exactDiff, exactStatus && exactDiff
        ? 'DSH Harness changes exactly match the audited Workspace resource-slot overlay'
        : `DSH Harness changes diverge from the audited overlay:\n${dirty || '(clean checkout; overlay not applied)'}`)

      if (syncLinks && exactStatus && exactDiff && failures.length === 0) {
        rebuildOverlayPackage(sourceRoot)
        if (!appliedOverlay) passes.push('rebuilt the audited Harness overlay package')
      }
      validateLinkedArtifacts(sourceRoot)

      if (syncLinks && failures.length === 0) {
        for (const [packageName, sourcePath] of Object.entries(expectedLinks)) {
          if (packageName in (manifest.devDependencies ?? {})) {
            manifest.devDependencies[packageName] = `link:${relativePath(projectRoot, join(sourceRoot, sourcePath))}`
          }
          if (packageManifest && packageName in (packageManifest.devDependencies ?? {})) {
            packageManifest.devDependencies[packageName] = `link:${relativePath(packageRoot, join(sourceRoot, sourcePath))}`
          }
        }
        lock.localResolution.fallbackRelativePath = relativePath(projectRoot, sourceRoot)
        writeJsonAtomically(join(projectRoot, 'package.json'), manifest)
        if (packageManifest) writeJsonAtomically(packageManifestPath, packageManifest)
        writeJsonAtomically(join(projectRoot, 'dsh-reference.lock.json'), lock)
        passes.push(`synchronized Harness links to ${sourceRoot}`)
      }

      for (const [label, base, dependencyManifest] of [
        ['workspace', projectRoot, manifest],
        ['plugin', packageRoot, packageManifest],
      ]) {
        for (const [packageName, specifier] of Object.entries(dependencyManifest?.devDependencies ?? {})) {
          const sourcePath = expectedLinks[packageName]
          if (sourcePath === undefined || typeof specifier !== 'string') continue
          const linkedPath = specifier.startsWith('link:') ? resolve(base, specifier.slice('link:'.length)) : undefined
          const expectedPath = join(sourceRoot, sourcePath)
          check(
            linkedPath !== undefined
              && existsSync(linkedPath)
              && realpathSync(linkedPath) === realpathSync(expectedPath),
            `${label} ${packageName} development dependency links to the audited source`,
          )
        }
      }
      passes.push(`validated DSH source at ${sourceRoot}`)
    } catch (error) {
      failures.push(`cannot validate DSH source at ${sourceRoot}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

for (const message of passes) console.log(`PASS ${message}`)
for (const message of warnings) console.warn(`WARN ${message}`)
for (const message of failures) console.error(`FAIL ${message}`)

if (failures.length > 0) {
  console.error(`\ncontext check failed: ${failures.length} failure(s), ${warnings.length} warning(s)`)
  process.exitCode = 1
} else {
  console.log(`\ncontext check passed: ${passes.length} check(s), ${warnings.length} warning(s)`)
}
