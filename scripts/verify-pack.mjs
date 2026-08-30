#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(projectRoot, 'packages/graph-workflow')
const destination = mkdtempSync(join(tmpdir(), 'dsh-pack-check-'))
try {
  const result = spawnSync('pnpm', ['pack', '--json', '--pack-destination', destination], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'pnpm pack failed')
  }

  const start = result.stdout.indexOf('{')
  const end = result.stdout.lastIndexOf('}')
  const packed = JSON.parse(result.stdout.slice(start, end + 1))
  if (typeof packed.filename !== 'string' || !existsSync(packed.filename)) {
    throw new Error('pnpm pack did not create the reported archive')
  }

  const files = new Set((packed.files ?? []).map(file => file.path))
  const required = [
    'README.md',
    'cordis.patch.yml',
    'lib/client.js',
    'lib/index.js',
    'lib/typert.host.d.ts',
    'lib/typert.host.js',
    'lib/typert.remote-client.d.ts',
    'lib/typert.remote-client.js',
    'lib/types/client/index.d.ts',
    'lib/types/index.d.ts',
    'lib/types/types.d.ts',
    'lib/types/types.js',
    'package.json',
  ]

  const missing = required.filter(file => !files.has(file))
  const leaked = [...files].filter(file => file.startsWith('src/')
    || file.startsWith('tests/')
    || file.endsWith('.map')
    || file.endsWith('.tsbuildinfo'))
  if (missing.length > 0) console.error(`packed artifact is missing: ${missing.join(', ')}`)
  if (leaked.length > 0) console.error(`packed artifact leaks development files: ${leaked.join(', ')}`)
  if (missing.length > 0 || leaked.length > 0) process.exitCode = 1
  else console.log(`packed artifact check passed: ${files.size} file(s)`)
} catch (error) {
  console.error(`packed artifact check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(destination, { recursive: true, force: true })
}
