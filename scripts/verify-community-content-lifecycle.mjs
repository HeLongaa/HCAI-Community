import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/community-content-lifecycle-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0076_community_post_lifecycle/migration.sql')
const routes = read('server/src/modules/posts/routes.js')
const seed = read('server/src/repositories/seedRepository.js')
const prisma = read('server/src/repositories/prismaRepository.js')
const openapi = read('server/src/docs/openapi.js')
const policies = json('config/entity-operation-policies.json')
const ui = read('src/features/community/CommunityPage.tsx')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })

add('contract is COMM-01 personal-account scope', contract.task === 'COMM-01' && contract.scope === 'personal_accounts_only')
add('post lifecycle enum is closed', /enum PostStatus\s*\{[\s\S]*draft[\s\S]*published[\s\S]*deleted/.test(schema))
add('post lifecycle evidence is modeled', ['status', 'version', 'updatedAt', 'publishedAt', 'deletedAt', 'deletionReasonCode'].every((field) => schema.includes(field)))
add('migration preserves existing posts as published', migration.includes("DEFAULT 'published'") && migration.includes('SET "published_at" = "created_at"'))
add('post operation policy remains soft delete', policies.entities.some((entry) => entry.model === 'Post' && entry.policy === contract.operationPolicy && entry.hardDelete === false))
add('seed repository filters public lifecycle', seed.includes("postStatus(post) !== 'published'") && seed.includes("status: 'deleted'"))
add('Prisma repository filters public lifecycle', prisma.includes("status: 'published'") && prisma.includes('version: { increment: 1 }'))
add('owner UI exposes draft and lifecycle actions', ['Save draft', 'publishPost', 'updatePost', 'deletePost'].every((marker) => ui.includes(marker)))

for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  const documentedPath = route.path.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documentedPath}'`))
}

add('runbook exists', fs.existsSync(path.join(root, 'docs/COMMUNITY_CONTENT_LIFECYCLE.md')))
add('focused package gate exists', packageJson.scripts['test:community-content-lifecycle']?.includes('verify-community-content-lifecycle.mjs'))
add('integration package gate exists', packageJson.scripts['test:community-content-lifecycle:integration']?.includes('prismaCommunityContent.integration.test.js'))
add('quick gate includes COMM-01', packageJson.scripts['check:quick']?.includes('npm run test:community-content-lifecycle'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Community content lifecycle verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Community content lifecycle verified: ${checks.length} checks`)
}
