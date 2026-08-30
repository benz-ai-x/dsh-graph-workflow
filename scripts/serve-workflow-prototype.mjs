import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const prototypeRoot = join(repositoryRoot, 'packages', 'graph-workflow', 'prototypes', 'workspace-workflow')
const host = '127.0.0.1'
const port = 4179

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
    return
  }

  const url = new URL(request.url ?? '/', `http://${host}:${String(port)}`)
  const relative = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    .replace(/^[/\\]+/, '')
  const target = join(prototypeRoot, relative)

  if (!target.startsWith(`${prototypeRoot}/`)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  try {
    const info = await stat(target)
    if (!info.isFile()) throw new Error('not a file')
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes[extname(target)] ?? 'application/octet-stream',
    })
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
})

server.listen(port, host, () => {
  console.log(`Graph Workflow UI prototype: http://${host}:${String(port)}/?variant=A`)
  console.log('Use ← / → or the floating review bar to switch variants.')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => { process.exit(0) })
  })
}
