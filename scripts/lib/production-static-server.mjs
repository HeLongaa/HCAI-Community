import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const mimeTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const etagFor = (stat) => `W/\"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}\"`

const parseRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match) return null
  let start = match[1] ? Number(match[1]) : null
  let end = match[2] ? Number(match[2]) : null
  if (start === null && end !== null) {
    start = Math.max(0, size - end)
    end = size - 1
  } else {
    start ??= 0
    end ??= size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

const acceptsEncoding = (header, encoding) => (header ?? '')
  .split(',')
  .map((value) => value.trim().split(';')[0])
  .includes(encoding)

export function createProductionStaticServer({ rootDirectory, contract }) {
  const root = path.resolve(rootDirectory)
  const indexPath = path.join(root, 'index.html')
  if (!fs.existsSync(indexPath)) throw new Error(`Production index is missing: ${indexPath}`)

  return http.createServer((request, response) => {
    for (const [name, value] of Object.entries(contract.securityHeaders)) response.setHeader(name, value)

    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      response.statusCode = 405
      response.setHeader('allow', 'GET, HEAD')
      response.end()
      return
    }

    const rawPath = (request.url ?? '/').split('?')[0]
    let pathname
    try {
      pathname = decodeURIComponent(rawPath)
    } catch {
      response.statusCode = 400
      response.end('Bad request')
      return
    }
    if (pathname.includes('\0') || pathname.split('/').includes('..')) {
      response.statusCode = 400
      response.end('Bad request')
      return
    }

    if (pathname === '/healthz') {
      const body = Buffer.from(JSON.stringify({ status: 'ok', service: 'hcai-static' }))
      response.statusCode = 200
      response.setHeader('cache-control', contract.healthCacheControl)
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('content-length', body.byteLength)
      if (request.method === 'HEAD') response.end()
      else response.end(body)
      return
    }

    const isBackendRoute = pathname === '/health'
      || pathname === '/metrics'
      || pathname === '/api'
      || pathname.startsWith('/api/')
    if (isBackendRoute) {
      response.statusCode = 404
      response.setHeader('cache-control', contract.healthCacheControl)
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ error: { code: 'BACKEND_ROUTE_NOT_CONFIGURED' } }))
      return
    }

    const requestedPath = path.resolve(root, `.${pathname}`)
    if (requestedPath !== root && !requestedPath.startsWith(`${root}${path.sep}`)) {
      response.statusCode = 400
      response.end('Bad request')
      return
    }
    const requestedStat = fs.existsSync(requestedPath) ? fs.statSync(requestedPath) : null
    const isAssetRequest = pathname.startsWith('/assets/')
    let filePath = requestedStat?.isFile() ? requestedPath : null
    let isHtmlFallback = false
    if (!filePath && !isAssetRequest) {
      filePath = indexPath
      isHtmlFallback = true
    }
    if (!filePath) {
      response.statusCode = 404
      response.setHeader('cache-control', contract.htmlCacheControl)
      response.end('Not found')
      return
    }

    const sourceStat = fs.statSync(filePath)
    const sourceExtension = path.extname(filePath).toLowerCase()
    const range = request.headers.range ? parseRange(request.headers.range, sourceStat.size) : null
    if (request.headers.range && !range) {
      response.statusCode = 416
      response.setHeader('content-range', `bytes */${sourceStat.size}`)
      response.end()
      return
    }

    let bodyPath = filePath
    let contentEncoding = null
    if (!range && !isHtmlFallback) {
      if (acceptsEncoding(request.headers['accept-encoding'], 'br') && fs.existsSync(`${filePath}.br`)) {
        bodyPath = `${filePath}.br`
        contentEncoding = 'br'
      } else if (acceptsEncoding(request.headers['accept-encoding'], 'gzip') && fs.existsSync(`${filePath}.gz`)) {
        bodyPath = `${filePath}.gz`
        contentEncoding = 'gzip'
      }
    }

    const bodyStat = fs.statSync(bodyPath)
    const immutable = pathname.startsWith('/assets/') && !isHtmlFallback
    response.setHeader('accept-ranges', 'bytes')
    response.setHeader('cache-control', immutable ? contract.assetCacheControl : contract.htmlCacheControl)
    response.setHeader('content-type', mimeTypes.get(sourceExtension) ?? 'application/octet-stream')
    response.setHeader('etag', etagFor(sourceStat))
    if (fs.existsSync(`${filePath}.br`) || fs.existsSync(`${filePath}.gz`)) response.setHeader('vary', 'Accept-Encoding')
    if (contentEncoding) response.setHeader('content-encoding', contentEncoding)

    if (range) {
      const length = range.end - range.start + 1
      response.statusCode = 206
      response.setHeader('content-range', `bytes ${range.start}-${range.end}/${sourceStat.size}`)
      response.setHeader('content-length', length)
      if (request.method === 'HEAD') response.end()
      else fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(response)
      return
    }

    response.statusCode = 200
    response.setHeader('content-length', bodyStat.size)
    if (request.method === 'HEAD') response.end()
    else fs.createReadStream(bodyPath).pipe(response)
  })
}
