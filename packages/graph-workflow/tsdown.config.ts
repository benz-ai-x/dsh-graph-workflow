import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-graph-workflow'
const CSS_PREFIX = '\0graph-workflow-css:'
const CSS_SUFFIX = '.mjs'

const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

function cssModule(file: string, source: Uint8Array): string {
  const compiled = transform({
    filename: file,
    code: source,
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  const classes = Object.fromEntries(
    Object.entries(compiled.exports ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, value.name]),
  )
  const tag = `${PACKAGE_ID}/${basename(file)}`
  return [
    `const css = ${JSON.stringify(compiled.code.toString())};`,
    `const tag = ${JSON.stringify(tag)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tag) + ']') === null) {",
    "  const node = document.createElement('style');",
    `  node.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
    '  node.dataset.pluginCss = tag;',
    '  node.textContent = css;',
    '  document.head.appendChild(node);',
    '}',
    `export default ${JSON.stringify(classes)};`,
  ].join('\n')
}

const host: UserConfig = {
  name: PACKAGE_ID,
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const client: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: specifier => !CLIENT_EXTERNALS.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'graph-workflow-client-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.has(source)) return null
      throw new Error(`Graph Workflow Client cannot inline the cross-plugin runtime ${source}`)
    },
  }, {
    name: 'graph-workflow-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_PREFIX + resolve(dirname(importer), source) + CSS_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_PREFIX)) return null
      const file = virtualId.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      return cssModule(file, await readFile(file))
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([host, client])
