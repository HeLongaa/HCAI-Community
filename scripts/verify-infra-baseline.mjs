import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/infra-baseline-contract.json'), 'utf8'))
const envSource = fs.readFileSync(path.join(root, contract.envSource), 'utf8')
const negativeSmoke = fs.readFileSync(path.join(root, 'scripts/smoke-production-negative.mjs'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('infra contract scope is INFRA-01', contract.scope === 'INFRA-01', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
for (const service of contract.requiredServices) add(`${service.id} env is recognized`, envSource.includes(service.env), service.env)
for (const field of contract.requiredEnvFields) add(`buildEnv exposes ${field}`, envSource.includes(field), field)
for (const env of contract.environments) add(`environment ${env} is supported`, envSource.includes(`'${env}'`), env)
add('production requires Secret Manager', envSource.includes('SECRET_MANAGER_PROVIDER is required in production'), 'secret manager')
add('production rejects mock storage', envSource.includes('Production requires STORAGE_DRIVER=s3'), 'mock storage')
add('negative production smoke covers infrastructure baseline', negativeSmoke.includes('SECRET_MANAGER_PROVIDER') && negativeSmoke.includes("STORAGE_DRIVER: 'mock'"), 'negative smoke')
add('package exposes INFRA-01 gate', packageJson.scripts['test:infra-baseline'] === 'node scripts/verify-infra-baseline.mjs && node --test server/src/config/env.test.js')
add('quick gate includes INFRA-01 gate', packageJson.scripts['check:quick']?.includes('npm run test:infra-baseline'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Infrastructure baseline failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Infrastructure baseline verified: ${checks.length} checks, ${contract.requiredServices.length} services`)
