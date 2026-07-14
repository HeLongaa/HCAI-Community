import fs from 'node:fs'
import path from 'node:path'

export const readFiles = (dir, predicate) => fs
  .readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return readFiles(fullPath, predicate)
    return predicate(fullPath) ? [fullPath] : []
  })

export const normalizePath = (pathname) => String(pathname).replace(/\/+$/, '') || '/'
export const routeKey = (method, pathname) => `${method.toUpperCase()} ${normalizePath(pathname)}`

export const parseServerRoutes = (root, routeRoot) => {
  const files = readFiles(path.join(root, routeRoot), (file) => file.endsWith('/routes.js'))
  const routePattern = /router\.add\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g
  return files.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8')
    return [...source.matchAll(routePattern)].map((match) => ({
      method: match[1],
      pathname: normalizePath(match[2]),
      key: routeKey(match[1], match[2]),
      file: path.relative(root, file),
    }))
  })
}

