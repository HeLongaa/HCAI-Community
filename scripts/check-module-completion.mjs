#!/usr/bin/env node
import path from 'node:path'

import { checkModuleCompletion } from './lib/module-scaffolding.mjs'

const args = process.argv.slice(2)
const valueFor = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}
const manifestPath = valueFor('--manifest')
if (!manifestPath) {
  console.error('Usage: npm run check:module -- --manifest <file> [--root <repository>] [--stage scaffold|complete]')
  process.exit(2)
}

try {
  const root = path.resolve(valueFor('--root') ?? process.cwd())
  const result = checkModuleCompletion({ root, manifestPath, stage: valueFor('--stage') ?? 'complete' })
  for (const check of result.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
  if (result.failures.length) {
    console.error(`Module completion failed: ${result.failures.length} check(s)`)
    process.exit(1)
  }
  console.log(`Module ${result.manifest.id} passed ${result.stage} completion: ${result.checks.length} checks`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
