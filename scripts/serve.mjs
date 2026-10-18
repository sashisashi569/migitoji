#!/usr/bin/env node
// 依存ゼロの静的ファイル配信サーバー (自ホスト用)。
// foliate-js はネイティブ ESM なのでバンドラは不要。
import { createServer } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 8000)
const HOST = process.env.HOST ?? '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.fb2': 'application/x-fictionbook+xml',
  '.cbz': 'application/vnd.comicbook+zip',
  '.pdf': 'application/pdf',
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers })
  res.end(body)
}

const resolvePath = urlPath => {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const target = normalize(join(ROOT, decoded))
  // ディレクトリトラバーサル防止
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null
  return target
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })

  let filePath = resolvePath(req.url ?? '/')
  if (!filePath) return send(res, 403, 'Forbidden')

  try {
    let stat = await fs.stat(filePath).catch(() => null)
    if (stat?.isDirectory()) {
      filePath = join(filePath, 'index.html')
      stat = await fs.stat(filePath).catch(() => null)
      if (!stat) {
        const entries = await fs.readdir(filePath.replace(/index\.html$/, ''))
        return send(res, 200,
          `<!doctype html><meta charset="utf-8"><h1>Index of ${req.url}</h1><ul>${
            entries.map(e => `<li><a href="${join(req.url ?? '/', e)}">${e}</a></li>`).join('')
          }</ul>`,
          { 'Content-Type': 'text/html; charset=utf-8' })
      }
    }
    if (!stat || !stat.isFile()) return send(res, 404, 'Not Found')

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    }

    const range = req.headers.range
    if (range && /^bytes=(\d*)-(\d*)$/.test(range)) {
      const [, s, e] = range.match(/^bytes=(\d*)-(\d*)$/)
      const start = s ? Number(s) : 0
      const end = e ? Number(e) : stat.size - 1
      if (start > end || end >= stat.size) {
        return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` })
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(filePath, { start, end }).pipe(res)
    }

    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    createReadStream(filePath).pipe(res)
  } catch (err) {
    console.error(err)
    send(res, 500, 'Internal Server Error')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`migitoji: http://${HOST}:${PORT}/`)
  console.log(`root: ${ROOT}`)
})
