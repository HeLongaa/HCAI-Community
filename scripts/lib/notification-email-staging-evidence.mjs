import { canonicalJson, findForbiddenEvidencePaths, sha256 } from './release-infrastructure-rehearsal.mjs'

export const evidenceSchemaVersion = 'notification-email-staging-evidence-v1'

export const receiptHash = (evidence) => {
  const { receiptHash: _ignored, ...unsigned } = evidence
  return sha256(canonicalJson(unsigned))
}

const hashPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const runPattern = /^nemail-[0-9]{14}-[a-f0-9]{8}$/
const requiredFalseLimitations = [
  'mailboxDeliveryVerified',
  'bounceHandlingVerified',
  'complaintHandlingVerified',
  'targetProductionEnvironmentVerified',
]

export const evaluateObjectives = ({ source = {}, relay = {}, delivery = {}, controls = {} } = {}) => ({
  sourceArtifactBound: commitPattern.test(source.gitCommit ?? '') && hashPattern.test(source.artifactSha256 ?? ''),
  relayIdentityHashed: hashPattern.test(relay.hostSha256 ?? '') && hashPattern.test(relay.senderDomainSha256 ?? '') && hashPattern.test(relay.recipientDomainSha256 ?? ''),
  acceptedWithReceipt: delivery.outcome === 'sent' && delivery.statusCode >= 200 && delivery.statusCode < 300 && hashPattern.test(delivery.providerReceiptSha256 ?? '') && ['x-message-id', 'x-request-id'].includes(delivery.receiptHeader),
  transportControls: controls.https === true && controls.hmacSha256 === true && controls.senderConfigured === true && controls.providerReceiptRequired === true,
})

export const buildEvidence = ({ run, source, relay, delivery, controls, limitations, checks = [] }) => {
  const objectives = evaluateObjectives({ source, relay, delivery, controls })
  const failed = checks.filter((check) => check.pass !== true).length
  const evidence = {
    schemaVersion: evidenceSchemaVersion,
    status: 'passed',
    environment: 'staging',
    scope: 'notification_email_relay_acceptance',
    run,
    source,
    relay,
    delivery,
    controls,
    limitations,
    checks,
    result: {
      total: checks.length,
      passed: checks.length - failed,
      failed,
      objectives,
      relayAcceptanceComplete: failed === 0 && Object.values(objectives).every(Boolean),
      productionApproved: false,
    },
  }
  return { ...evidence, receiptHash: receiptHash(evidence) }
}

export const verifyEvidence = (evidence) => {
  const failures = []
  if (evidence?.schemaVersion !== evidenceSchemaVersion) failures.push('schema_version')
  if (evidence?.status !== 'passed') failures.push('status')
  if (evidence?.environment !== 'staging') failures.push('environment')
  if (evidence?.scope !== 'notification_email_relay_acceptance') failures.push('scope')
  for (const section of ['run', 'source', 'relay', 'delivery', 'controls', 'limitations', 'checks', 'result', 'receiptHash']) {
    if (evidence?.[section] == null) failures.push(`missing_${section}`)
  }
  if (!runPattern.test(evidence?.run?.id ?? '')) failures.push('run_id')
  if (!commitPattern.test(evidence?.source?.gitCommit ?? '')) failures.push('source_git_commit')
  if (!hashPattern.test(evidence?.source?.artifactSha256 ?? '')) failures.push('source_artifact_hash')
  if (findForbiddenEvidencePaths(evidence).length > 0) failures.push('forbidden_fields')
  if (evidence?.receiptHash !== receiptHash(evidence ?? {})) failures.push('receipt_hash')
  if (requiredFalseLimitations.some((name) => evidence?.limitations?.[name] !== false)) failures.push('production_limitations')
  if (evidence?.result?.relayAcceptanceComplete !== true || evidence?.result?.productionApproved !== false) failures.push('result')
  if (!Object.values(evaluateObjectives(evidence ?? {})).every(Boolean)) failures.push('objectives')
  return { valid: failures.length === 0, failures }
}
