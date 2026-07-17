import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

import { checkModuleCompletion, generateModule, loadScaffoldingContract } from './lib/module-scaffolding.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const validSpec = () => ({
  schemaVersion: 1,
  id: 'sample-notes',
  displayName: 'Sample Notes',
  model: 'SampleNote',
  domain: 'community',
  ownerTask: 'SAMPLE-01',
  routeSegment: 'sample-notes',
  operationPolicy: 'mutable_crud',
  permissions: { read: 'sample-notes:read', manage: 'sample-notes:manage' },
})

const withTempRoot = (callback) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'museflow-module-'))
  try {
    return callback(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('module generator plans without writing and creates the full bounded skeleton', () => withTempRoot((root) => {
  const planned = generateModule({ repositoryRoot, outputRoot: root, spec: validSpec(), dryRun: true })
  assert.equal(planned.artifacts.length, 12)
  assert.equal(fs.readdirSync(root).length, 0)

  const created = generateModule({ repositoryRoot, outputRoot: root, spec: validSpec() })
  assert.equal(created.artifacts.length, 12)
  assert.ok(fs.existsSync(path.join(root, created.manifestPath)))
  assert.match(fs.readFileSync(path.join(root, 'server/src/modules/sampleNotes/routes.js'), 'utf8'), /registerSampleNotesRoutes/)
  assert.match(fs.readFileSync(path.join(root, 'src/features/sampleNotes/SampleNotesPage.tsx'), 'utf8'), /Sample Notes/)

  for (const relativePath of created.manifest.requiredArtifacts.filter((file) => /\.(?:js|ts|tsx)$/.test(file))) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    const kind = relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : relativePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
    const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.ESNext, true, kind)
    assert.deepEqual(parsed.parseDiagnostics, [], `${relativePath} must parse`)
  }

  const scaffold = checkModuleCompletion({ root, manifestPath: created.manifestPath, stage: 'scaffold' })
  assert.equal(scaffold.failures.length, 0)
  assert.throws(() => generateModule({ repositoryRoot, outputRoot: root, spec: validSpec() }), /DX_SCAFFOLD_CONFLICT/)
}))

test('complete stage fails closed on placeholders and missing integration, then accepts exact evidence', () => withTempRoot((root) => {
  const created = generateModule({ repositoryRoot, outputRoot: root, spec: validSpec() })
  const incomplete = checkModuleCompletion({ root, manifestPath: created.manifestPath, stage: 'complete' })
  assert.ok(incomplete.failures.some((check) => check.name.includes('completion marker removed')))
  assert.ok(incomplete.failures.some((check) => check.name === 'server route registration'))

  for (const relativePath of created.manifest.requiredArtifacts) {
    const target = path.join(root, relativePath)
    const source = fs.readFileSync(target, 'utf8')
      .replaceAll('TODO(DX-SCAFFOLD)', 'implemented')
      .replaceAll('MODULE_NOT_IMPLEMENTED', 'MODULE_UNAVAILABLE')
    fs.writeFileSync(target, source)
  }
  const evidenceByPath = new Map()
  for (const integration of created.manifest.integrationChecks) {
    const values = evidenceByPath.get(integration.path) ?? []
    values.push(integration.includes)
    evidenceByPath.set(integration.path, values)
  }
  for (const [relativePath, values] of evidenceByPath) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, values.join('\n'))
  }

  const complete = checkModuleCompletion({ root, manifestPath: created.manifestPath, stage: 'complete' })
  assert.equal(complete.failures.length, 0)
}))

test('module specs reject unknown domains, shared-account scope, unsafe ids, and invalid permissions', () => {
  for (const override of [
    { domain: 'unknown-domain' },
    { id: 'team', displayName: 'Team' },
    { id: '../escape' },
    { model: '../Unsafe' },
    { displayName: "Unsafe ' Label" },
    { permissions: { read: 'invalid', manage: 'sample-notes:manage' } },
  ]) {
    assert.throws(
      () => withTempRoot((root) => generateModule({ repositoryRoot, outputRoot: root, spec: { ...validSpec(), ...override } })),
      /DX_MODULE_SPEC_INVALID/,
    )
  }
})

test('scaffolding contract declares every real template exactly once', () => {
  const contract = loadScaffoldingContract(repositoryRoot)
  assert.equal(new Set(contract.templates).size, contract.templates.length)
  for (const template of contract.templates) assert.ok(fs.existsSync(path.join(repositoryRoot, contract.templateRoot, template)), template)
})
