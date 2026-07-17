#!/usr/bin/env node
import path from 'node:path'

import { generateModule, readModuleSpec } from './lib/module-scaffolding.mjs'

const args = process.argv.slice(2)
const valueFor = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}
const specArg = valueFor('--spec')
if (!specArg) {
  console.error('Usage: npm run scaffold:module -- --spec <file> [--root <output>] [--dry-run]')
  process.exit(2)
}

try {
  const repositoryRoot = process.cwd()
  const outputRoot = path.resolve(valueFor('--root') ?? repositoryRoot)
  const result = generateModule({
    repositoryRoot,
    outputRoot,
    spec: readModuleSpec(path.resolve(specArg)),
    dryRun: args.includes('--dry-run'),
  })
  for (const artifact of result.artifacts) console.log(`${result.dryRun ? 'PLAN' : 'CREATE'} ${artifact}`)
  console.log(`${result.dryRun ? 'Planned' : 'Created'} ${result.artifacts.length} artifacts for ${result.context.id}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
