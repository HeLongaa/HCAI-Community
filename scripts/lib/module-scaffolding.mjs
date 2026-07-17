import fs from 'node:fs'
import path from 'node:path'

const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const taskPattern = /^[A-Z][A-Z0-9-]*$/
const modelPattern = /^[A-Z][A-Za-z0-9]*$/
const permissionPattern = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/
const displayNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} .&()/-]{0,79}$/u

const templateTargets = Object.freeze({
  'server/routes.js.tpl': ({ moduleDir }) => `server/src/modules/${moduleDir}/routes.js`,
  'server/routes.test.js.tpl': ({ moduleDir }) => `server/src/modules/${moduleDir}/routes.test.js`,
  'server/application.js.tpl': ({ moduleDir }) => `server/src/${moduleDir}/application.js`,
  'server/domain.js.tpl': ({ moduleDir }) => `server/src/${moduleDir}/domain.js`,
  'server/repositoryPort.js.tpl': ({ moduleDir }) => `server/src/${moduleDir}/repositoryPort.js`,
  'server/openapi.js.tpl': ({ moduleDir }) => `server/src/docs/${moduleDir}.openapi.js`,
  'frontend/Page.tsx.tpl': ({ moduleDir, pascalName }) => `src/features/${moduleDir}/${pascalName}Page.tsx`,
  'frontend/service.ts.tpl': ({ camelName }) => `src/services/${camelName}Service.ts`,
  'frontend/contracts.ts.tpl': ({ camelName }) => `src/services/${camelName}Contracts.ts`,
  'e2e/module.spec.ts.tpl': ({ id }) => `e2e/${id}.spec.ts`,
  'docs/module.md.tpl': ({ constantName }) => `docs/${constantName}.md`,
})

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const resolveInside = (root, relativePath) => {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error(`DX_PATH_INVALID:${relativePath}`)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`DX_PATH_ESCAPE:${relativePath}`)
  return resolved
}

const wordsFor = (id) => id.split('-').filter(Boolean)
const pascalFor = (id) => wordsFor(id).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join('')
const camelFor = (id) => {
  const pascal = pascalFor(id)
  return `${pascal[0].toLowerCase()}${pascal.slice(1)}`
}

const render = (source, context) => source.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key) => {
  if (!(key in context)) throw new Error(`DX_TEMPLATE_TOKEN_UNKNOWN:${key}`)
  return String(context[key])
})

export const loadScaffoldingContract = (repositoryRoot) => readJson(path.join(repositoryRoot, 'config/module-scaffolding-contract.json'))

export const validateModuleSpec = (spec, { contract, domains }) => {
  const failures = []
  if (spec?.schemaVersion !== 1) failures.push('schemaVersion must be 1')
  if (!idPattern.test(spec?.id ?? '')) failures.push('id must be lower kebab-case')
  if (!displayNamePattern.test(spec?.displayName ?? '')) failures.push('displayName must be a safe 1-80 character label')
  if (!modelPattern.test(spec?.model ?? '')) failures.push('model must be PascalCase')
  if (!domains.has(spec?.domain)) failures.push(`domain must be registered: ${spec?.domain ?? ''}`)
  if (!taskPattern.test(spec?.ownerTask ?? '')) failures.push('ownerTask must be an uppercase task id')
  if (!idPattern.test(spec?.routeSegment ?? '')) failures.push('routeSegment must be lower kebab-case')
  if (!contract.operationPolicies.includes(spec?.operationPolicy)) failures.push(`operationPolicy is unsupported: ${spec?.operationPolicy ?? ''}`)
  for (const permission of [spec?.permissions?.read, spec?.permissions?.manage]) {
    if (!permissionPattern.test(permission ?? '')) failures.push(`invalid permission id: ${permission ?? ''}`)
  }
  if (spec?.permissions?.read === spec?.permissions?.manage) failures.push('read and manage permissions must differ')

  const scopeWords = [spec?.id, spec?.displayName, spec?.model, spec?.domain, spec?.routeSegment]
    .flatMap((value) => String(value ?? '').toLowerCase().split(/[^a-z0-9]+/))
  const forbidden = contract.forbiddenScopeTokens.filter((token) => scopeWords.includes(token))
  if (forbidden.length) failures.push(`shared-account scope is forbidden: ${forbidden.join(', ')}`)
  if (failures.length) throw new Error(`DX_MODULE_SPEC_INVALID:${failures.join('; ')}`)
}

export const buildModuleContext = (spec) => ({
  ...spec,
  pascalName: pascalFor(spec.id),
  camelName: camelFor(spec.id),
  moduleDir: camelFor(spec.id),
  constantName: spec.id.toUpperCase().replaceAll('-', '_'),
  readPermission: spec.permissions.read,
  managePermission: spec.permissions.manage,
})

const buildManifest = (context, artifactPaths, contract) => ({
  schemaVersion: 1,
  kind: 'museflow-module-definition',
  scope: 'personal_accounts_only',
  id: context.id,
  displayName: context.displayName,
  model: context.model,
  domain: context.domain,
  ownerTask: context.ownerTask,
  operationPolicy: context.operationPolicy,
  permissions: { read: context.readPermission, manage: context.managePermission },
  route: `GET /api/${context.routeSegment}`,
  requiredArtifacts: artifactPaths,
  completionMarkers: contract.completionMarkers,
  integrationChecks: [
    { name: 'server route registration', path: 'server/src/modules/index.js', includes: `register${context.pascalName}Routes` },
    { name: 'architecture inventory', path: 'config/domain-boundaries.json', includes: `\"id\": \"${context.moduleDir}\"` },
    { name: 'read permission registry', path: 'server/src/auth/permissions.js', includes: context.readPermission },
    { name: 'manage permission registry', path: 'server/src/auth/permissions.js', includes: context.managePermission },
    { name: 'data operation policy', path: 'config/entity-operation-policies.json', includes: `\"model\": \"${context.model}\"` },
    { name: 'mutation audit classification', path: 'config/admin-mutation-audit.json', includes: `POST /api/${context.routeSegment}` },
    { name: 'bounded request parser', path: 'server/src/contracts/requestParsers.js', includes: `parse${context.pascalName}Request` },
    { name: 'seed repository adapter', path: 'server/src/repositories/seedRepository.js', includes: context.camelName },
    { name: 'Prisma repository adapter', path: 'server/src/repositories/prismaRepository.js', includes: context.camelName },
    { name: 'OpenAPI registration', path: 'server/src/docs/openapi.js', includes: `${context.camelName}OpenApi` },
    { name: 'frontend navigation', path: 'src/components/layout/PageRenderer.tsx', includes: `${context.pascalName}Page` },
    { name: 'focused package gate', path: 'package.json', includes: `test:${context.id}` },
    { name: 'quick gate registration', path: 'package.json', includes: `npm run test:${context.id}` },
  ],
})

export const generateModule = ({ repositoryRoot, outputRoot = repositoryRoot, spec, dryRun = false }) => {
  const contract = loadScaffoldingContract(repositoryRoot)
  const boundaries = readJson(path.join(repositoryRoot, 'config/domain-boundaries.json'))
  const domains = new Set(boundaries.ownership.map((entry) => entry.domain))
  validateModuleSpec(spec, { contract, domains })
  const context = buildModuleContext(spec)
  const templateRoot = path.join(repositoryRoot, contract.templateRoot)
  const artifacts = contract.templates.map((template) => {
    const target = templateTargets[template]
    if (!target) throw new Error(`DX_TEMPLATE_TARGET_MISSING:${template}`)
    const relativePath = target(context)
    const source = fs.readFileSync(resolveInside(templateRoot, template), 'utf8')
    return { relativePath, content: render(source, context) }
  })
  const manifestPath = `config/modules/${context.id}.module.json`
  const manifest = buildManifest(context, artifacts.map((artifact) => artifact.relativePath), contract)
  artifacts.push({ relativePath: manifestPath, content: `${JSON.stringify(manifest, null, 2)}\n` })

  const conflicts = artifacts.filter(({ relativePath }) => fs.existsSync(resolveInside(outputRoot, relativePath))).map(({ relativePath }) => relativePath)
  if (conflicts.length) throw new Error(`DX_SCAFFOLD_CONFLICT:${conflicts.join(',')}`)
  if (!dryRun) {
    for (const artifact of artifacts) {
      const target = resolveInside(outputRoot, artifact.relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, artifact.content, { encoding: 'utf8', flag: 'wx' })
    }
  }
  return { context, manifest, manifestPath, artifacts: artifacts.map(({ relativePath }) => relativePath), dryRun }
}

export const checkModuleCompletion = ({ root, manifestPath, stage = 'complete' }) => {
  if (!['scaffold', 'complete'].includes(stage)) throw new Error(`DX_COMPLETION_STAGE_INVALID:${stage}`)
  const manifest = readJson(resolveInside(root, manifestPath))
  const checks = []
  const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
  add('module definition schema is supported', manifest.schemaVersion === 1 && manifest.kind === 'museflow-module-definition', `${manifest.schemaVersion}:${manifest.kind}`)
  add('module remains personal-account scoped', manifest.scope === 'personal_accounts_only', manifest.scope)
  add('required artifacts are declared', Array.isArray(manifest.requiredArtifacts) && manifest.requiredArtifacts.length >= 10, `${manifest.requiredArtifacts?.length ?? 0} artifact(s)`)

  for (const relativePath of manifest.requiredArtifacts ?? []) {
    let target
    try {
      target = resolveInside(root, relativePath)
      add(`artifact exists: ${relativePath}`, fs.existsSync(target) && fs.statSync(target).isFile(), relativePath)
    } catch (error) {
      add(`artifact path is safe: ${relativePath}`, false, error.message)
    }
  }

  if (stage === 'complete') {
    for (const relativePath of manifest.requiredArtifacts ?? []) {
      const target = resolveInside(root, relativePath)
      if (!fs.existsSync(target)) continue
      const source = fs.readFileSync(target, 'utf8')
      for (const marker of manifest.completionMarkers ?? []) add(`completion marker removed from ${relativePath}: ${marker}`, !source.includes(marker), marker)
    }
    for (const integration of manifest.integrationChecks ?? []) {
      const target = resolveInside(root, integration.path)
      const source = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
      add(integration.name, source.includes(integration.includes), `${integration.path} -> ${integration.includes}`)
    }
  }

  return { manifest, stage, checks, failures: checks.filter((check) => !check.pass) }
}

export const readModuleSpec = (specPath) => readJson(specPath)
