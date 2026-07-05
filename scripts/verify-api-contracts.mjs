import fs from 'node:fs'
import path from 'node:path'
import { openApiDocument } from '../server/src/docs/openapi.js'

const workspaceRoot = process.cwd()
const routeRoot = path.join(workspaceRoot, 'server/src/modules')
const permissionMatrixPath = path.join(workspaceRoot, 'docs/PERMISSION_MATRIX.md')

const ignoredRouteKeys = new Set([
  'GET /health',
  'GET /api/openapi.json',
])

const readFiles = (dir, predicate) => fs
  .readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return readFiles(fullPath, predicate)
    return predicate(fullPath) ? [fullPath] : []
  })

const normalizeTemplate = (pathname) => {
  const clean = String(pathname).replace(/\/+$/, '') || '/'
  return clean
    .replace(/\{[^/}]+\}/g, ':param')
    .replace(/:[^/]+/g, ':param')
}

const routeKey = (method, pathname) => `${method.toUpperCase()} ${normalizeTemplate(pathname)}`
const openApiKey = (method, pathname) => `${method.toUpperCase()} ${normalizeTemplate(pathname)}`

const parseServerRoutes = () => {
  const files = readFiles(routeRoot, (file) => file.endsWith('/routes.js'))
  const routes = []
  const routePattern = /router\.add\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(routePattern)) {
      routes.push({
        method: match[1],
        pathname: match[2],
        key: routeKey(match[1], match[2]),
        file: path.relative(workspaceRoot, file),
      })
    }
  }
  return routes
}

const parseOpenApiRoutes = () => Object.entries(openApiDocument.paths ?? {}).flatMap(([pathname, methods]) =>
  Object.keys(methods).map((method) => ({
    method: method.toUpperCase(),
    pathname,
    key: openApiKey(method, `/api${pathname}`),
  })),
)

const parsePermissionMatrixRoutes = () => {
  const markdown = fs.readFileSync(permissionMatrixPath, 'utf8')
  const section = markdown.split('## Backend Route Guards')[1]?.split('## Repository-Level Ownership Checks')[0] ?? ''
  const routePattern = /\|\s*`([A-Z]+)\s+([^`]+)`\s*\|[^|]*\|([^|]+)\|([^|]+)\|/g
  return [...section.matchAll(routePattern)].map((match) => ({
    method: match[1],
    pathname: match[2].trim(),
    permission: match[3].trim().replace(/`/g, ''),
    coveredByTests: match[4].trim(),
    key: routeKey(match[1], match[2].trim()),
  }))
}

const compareSets = ({ expected, actual, label }) => {
  const actualKeys = new Set(actual.map((item) => item.key))
  return expected
    .filter((item) => !actualKeys.has(item.key))
    .map((item) => `${label}: ${item.key}`)
}

const serverRoutes = parseServerRoutes().filter((route) => !ignoredRouteKeys.has(route.key))
const openApiRoutes = parseOpenApiRoutes()
const matrixRoutes = parsePermissionMatrixRoutes()

const serverKeys = new Set(serverRoutes.map((route) => route.key))
const openApiKeys = new Set(openApiRoutes.map((route) => route.key))
const matrixKeys = new Set(matrixRoutes.map((route) => route.key))

const failures = [
  ...compareSets({ expected: openApiRoutes, actual: serverRoutes, label: 'OpenAPI route has no server route' }),
  ...compareSets({ expected: matrixRoutes, actual: serverRoutes, label: 'Permission matrix route has no server route' }),
  ...compareSets({ expected: matrixRoutes, actual: openApiRoutes, label: 'Permission matrix route missing from OpenAPI' }),
  ...matrixRoutes
    .filter((route) => route.coveredByTests !== 'Yes')
    .map((route) => `Permission matrix route is not marked test-covered: ${route.key}`),
]

const duplicateMatrixRoutes = matrixRoutes
  .filter((route, index) => matrixRoutes.findIndex((item) => item.key === route.key) !== index)
  .map((route) => `Duplicate permission matrix route: ${route.key}`)

failures.push(...duplicateMatrixRoutes)

if (failures.length > 0) {
  console.error('API contract verification failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log('API contract verification passed')
console.log(`  Server routes: ${serverKeys.size}`)
console.log(`  OpenAPI routes: ${openApiKeys.size}`)
console.log(`  Permission matrix protected routes: ${matrixKeys.size}`)
