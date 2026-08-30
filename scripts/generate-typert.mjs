/** Generate Typert artifacts in a temporary workspace containing the pinned meta packages. */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? join(workspace, '..', 'deepseek-harness'))
if (!existsSync(join(harnessRoot, 'tsconfig.base.json'))) {
  throw new Error(`generate-typert: pinned Harness source not found at ${harnessRoot}`)
}

const temporary = mkdtempSync(join(tmpdir(), 'dsh-graph-workflow-typert-'))

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function copyPackage(source, target) {
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'src'), join(target, 'src'), { recursive: true })
  cpSync(join(source, 'package.json'), join(target, 'package.json'))
  writeJson(join(target, 'tsconfig.json'), {
    extends: join(harnessRoot, 'tsconfig.base.json'),
    compilerOptions: { rootDir: 'src', outDir: 'lib/types' },
    include: ['src'],
  })
}

try {
  const packageRoot = join(temporary, 'packages', 'graph-workflow')
  const protocolRoot = join(temporary, 'packages', 'typert-protocol')
  const sessionRoot = join(temporary, 'packages', 'session')
  const agentRoot = join(temporary, 'packages', 'agent')
  copyPackage(join(workspace, 'packages', 'graph-workflow'), packageRoot)
  copyPackage(join(harnessRoot, 'packages', 'typert', 'protocol'), protocolRoot)
  copyPackage(join(harnessRoot, 'packages', 'core', 'session'), sessionRoot)
  copyPackage(join(harnessRoot, 'packages', 'core', 'agent'), agentRoot)

  const baseRead = ts.readConfigFile(join(harnessRoot, 'tsconfig.base.json'), ts.sys.readFile)
  if (baseRead.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(baseRead.error.messageText, '\n'))
  }
  const basePaths = baseRead.config?.compilerOptions?.paths ?? {}
  const paths = Object.fromEntries(Object.entries(basePaths).map(([specifier, targets]) => [
    specifier,
    targets.map(target => resolve(harnessRoot, target)),
  ]))
  paths['@deepseek-ai/dsh-typert-protocol'] = [join(protocolRoot, 'src', 'index.ts')]
  paths['@deepseek-ai/dsh-typert-protocol/types'] = [join(protocolRoot, 'src', 'types.ts')]
  paths['@deepseek-ai/dsh-session'] = [join(sessionRoot, 'src', 'index.ts')]
  paths['@deepseek-ai/dsh-session/types'] = [join(sessionRoot, 'src', 'types.ts')]
  paths['@deepseek-ai/dsh-agent'] = [join(agentRoot, 'src', 'index.ts')]
  paths['@deepseek-ai/dsh-agent/types'] = [join(agentRoot, 'src', 'types.ts')]
  paths['@deepseek-ai/dsh-agent/brand'] = [join(agentRoot, 'src', 'brand.ts')]

  writeJson(join(temporary, 'tsconfig.host.json'), {
    extends: join(harnessRoot, 'tsconfig.base.json'),
    compilerOptions: { paths },
    files: [],
    references: [
      { path: './packages/typert-protocol' },
      { path: './packages/session' },
      { path: './packages/agent' },
      { path: './packages/graph-workflow' },
    ],
  })

  const generator = new WorkspaceTypertGenerator(temporary, { checkDiagnostics: false })
  const artifacts = generator.generate(['dsh-graph-workflow'], ['host'])
  const artifact = artifacts.find(candidate =>
    candidate.packageRoot === 'packages/graph-workflow' && candidate.face === 'host')
  if (artifact === undefined || artifact.remote === undefined) {
    throw new Error('generate-typert: Host or Remote artifact was not emitted')
  }
  const output = join(workspace, 'packages', 'graph-workflow', 'lib')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'typert.host.js'), artifact.js)
  writeFileSync(join(output, 'typert.host.d.ts'), artifact.dts)
  writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
  writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
  writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
