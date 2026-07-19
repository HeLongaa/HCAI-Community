const definePermission = (id, module, resource, action, riskLevel, defaultRoles, options = {}) => Object.freeze({
  id,
  module,
  resource,
  action,
  riskLevel,
  defaultRoles: Object.freeze([...defaultRoles]),
  protected: Boolean(options.protected),
  protectionRank: Number(options.protectionRank ?? 0),
  resourceAuthorization: Boolean(options.resourceAuthorization),
  description: options.description ?? null,
})

const everyone = ['member', 'creator', 'publisher', 'moderator', 'admin']
const creators = ['creator', 'admin']
const publishers = ['publisher', 'admin']
const moderators = ['moderator', 'admin']
const admins = ['admin']

export const permissionRegistry = Object.freeze([
  definePermission('task:create', 'task-marketplace', 'task', 'create', 'medium', ['member', 'publisher', 'admin'], { resourceAuthorization: true, description: 'Create a task owned by the actor' }),
  definePermission('task:cancel', 'task-marketplace', 'task', 'cancel', 'high', ['member', 'publisher', 'admin'], { resourceAuthorization: true, description: 'Cancel an owned task before fulfillment starts' }),
  definePermission('task:propose', 'task-marketplace', 'task_proposal', 'create', 'medium', creators, { resourceAuthorization: true, description: 'Propose work on an eligible task' }),
  definePermission('task:claim', 'task-marketplace', 'task', 'claim', 'medium', creators, { resourceAuthorization: true, description: 'Claim an eligible task' }),
  definePermission('task:submit', 'task-marketplace', 'task_submission', 'create', 'high', creators, { resourceAuthorization: true, description: 'Submit work for an owned assignment' }),
  definePermission('task:review', 'task-marketplace', 'task_submission', 'review', 'high', publishers, { resourceAuthorization: true, description: 'Review submissions for an owned task' }),
  definePermission('task:moderate', 'task-marketplace', 'task', 'moderate', 'high', moderators, { resourceAuthorization: true, description: 'Moderate task lifecycle state' }),
  definePermission('post:create', 'community', 'post', 'create', 'low', everyone, { resourceAuthorization: true, description: 'Create a community post' }),
  definePermission('post:moderate', 'community', 'post', 'moderate', 'high', moderators, { resourceAuthorization: true, description: 'Moderate community content' }),
  definePermission('comment:create', 'community', 'comment', 'create', 'low', everyone, { resourceAuthorization: true, description: 'Create a community comment' }),
  definePermission('admin:community:read', 'community', 'community_content', 'read', 'high', moderators, { description: 'Read bounded community content administration projections and metrics' }),
  definePermission('admin:community:manage', 'community', 'community_content', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Edit and soft-delete or restore community posts and comments' }),
  definePermission('admin:community:export', 'community', 'community_metrics', 'export', 'critical', admins, { description: 'Export aggregate community health metrics without raw content' }),
  definePermission('points:read', 'entitlements-accounting', 'point_ledger', 'read', 'medium', everyone, { resourceAuthorization: true, description: 'Read the actor point ledger' }),
  definePermission('points:adjust', 'entitlements-accounting', 'point_ledger', 'adjust', 'critical', admins, { resourceAuthorization: true, description: 'Adjust user point balances' }),
  definePermission('entitlements:read', 'entitlements-accounting', 'personal_entitlement', 'read', 'medium', everyone, { resourceAuthorization: true, description: 'Read the actor effective personal entitlement' }),
  definePermission('developer:credentials:manage', 'developer-platform', 'service_account', 'manage', 'high', everyone, { resourceAuthorization: true, description: 'Manage actor-owned service accounts and one-time API keys' }),
  definePermission('developer:webhooks:manage', 'developer-platform', 'webhook_subscription', 'manage', 'high', everyone, { resourceAuthorization: true, description: 'Manage actor-owned webhook subscriptions, signing secrets, deliveries, and replay' }),
  definePermission('admin:access', 'admin-console', 'admin_console', 'access', 'high', moderators, { description: 'Access the administrative console' }),
  definePermission('admin:audit:read', 'audit-evidence', 'audit_event', 'read', 'high', moderators, { description: 'Read sanitized audit evidence' }),
  definePermission('admin:audit:export', 'audit-evidence', 'audit_event', 'export', 'high', admins, { description: 'Export portable verifiable audit evidence' }),
  definePermission('admin:audit:verify', 'audit-evidence', 'audit_event', 'verify', 'critical', admins, { description: 'Verify the immutable audit hash chain' }),
  definePermission('admin:audit:archive', 'audit-evidence', 'audit_archive_manifest', 'create', 'critical', admins, { protected: true, protectionRank: 9, resourceAuthorization: true, description: 'Create immutable audit archive manifests' }),
  definePermission('admin:audit:retention', 'audit-evidence', 'audit_retention_disposition', 'execute', 'critical', admins, { protected: true, protectionRank: 25, resourceAuthorization: true, description: 'Archive and prune expired audit prefixes under legal-hold controls' }),
  definePermission('admin:observability:read', 'observability-incident-response', 'observability_log', 'read', 'high', moderators, { description: 'Read sanitized application logs, traces, SLOs, and alerts' }),
  definePermission('admin:observability:export', 'observability-incident-response', 'observability_log', 'export', 'critical', admins, { description: 'Export bounded sanitized observability evidence' }),
  definePermission('admin:observability:manage', 'observability-incident-response', 'observability_alert', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Evaluate and disposition observability alerts' }),
  definePermission('admin:queue:read', 'admin-console', 'admin_review', 'read', 'high', moderators, { description: 'Read administrative review queues' }),
  definePermission('admin:queue:review', 'admin-console', 'admin_review', 'review', 'critical', moderators, { resourceAuthorization: true, description: 'Resolve administrative reviews' }),
  definePermission('admin:trust:read', 'trust-safety', 'moderation_case', 'read', 'high', moderators, { description: 'Read moderation cases and append-only evidence' }),
  definePermission('admin:trust:review', 'trust-safety', 'moderation_decision', 'create', 'critical', moderators, { resourceAuthorization: true, description: 'Create moderation and appeal decisions' }),
  definePermission('admin:trust:export', 'trust-safety', 'moderation_case', 'export', 'critical', admins, { description: 'Export sanitized moderation case evidence' }),
  definePermission('admin:trust:operate', 'trust-safety', 'moderation_queue', 'manage', 'critical', moderators, { resourceAuthorization: true, description: 'Assign and prioritize moderation queue cases without bulk decisions' }),
  definePermission('admin:trust:rules', 'trust-safety', 'safety_rule', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Create, canary, activate, retire, and roll back versioned safety rules' }),
  definePermission('admin:tasks:read', 'task-marketplace', 'task', 'read', 'high', moderators, { description: 'Read task operations projections and lifecycle evidence' }),
  definePermission('admin:tasks:manage', 'task-marketplace', 'task', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Edit eligible tasks and apply audited archive or status operations' }),
  definePermission('admin:task-rules:read', 'task-marketplace', 'task_rule', 'read', 'high', moderators, { description: 'Read versioned task rule drafts and published projections' }),
  definePermission('admin:task-rules:manage', 'task-marketplace', 'task_rule', 'manage', 'critical', admins, { protected: true, protectionRank: 25, resourceAuthorization: true, description: 'Create, edit, soft-delete, and restore task rule drafts' }),
  definePermission('admin:task-rules:publish', 'task-marketplace', 'task_rule', 'publish', 'critical', admins, { protected: true, protectionRank: 26, resourceAuthorization: true, description: 'Publish and roll back task rules used by task creation' }),
  definePermission('admin:media:read', 'media-platform', 'media_asset', 'read', 'high', moderators, { description: 'Read owner-safe media asset administration projections' }),
  definePermission('admin:media:manage', 'media-platform', 'media_asset', 'manage', 'critical', moderators, { resourceAuthorization: true, description: 'Review scans and manage media asset lifecycle state' }),
  definePermission('admin:media:export', 'media-platform', 'media_asset', 'export', 'critical', admins, { description: 'Export bounded owner-safe media asset evidence' }),
  definePermission('admin:accounting:read', 'entitlements-accounting', 'accounting_reconciliation', 'read', 'high', moderators, { description: 'Read internal accounting reconciliation evidence' }),
  definePermission('admin:accounting:scan', 'entitlements-accounting', 'accounting_reconciliation', 'scan', 'critical', admins, { description: 'Run internal accounting reconciliation scans' }),
  definePermission('admin:accounting:repair', 'entitlements-accounting', 'accounting_reconciliation', 'repair', 'critical', admins, { protected: true, protectionRank: 2, resourceAuthorization: true, description: 'Request and approve internal accounting compensation' }),
  definePermission('admin:entitlements:read', 'entitlements-accounting', 'personal_entitlement', 'read', 'high', moderators, { description: 'Read personal entitlement plans, versions, grants, and safe decision evidence' }),
  definePermission('admin:entitlements:manage', 'entitlements-accounting', 'personal_entitlement', 'manage', 'critical', admins, { protected: true, protectionRank: 27, resourceAuthorization: true, description: 'Create versioned personal entitlement plans and grants' }),
  definePermission('admin:entitlements:transition', 'entitlements-accounting', 'personal_entitlement', 'transition', 'critical', admins, { protected: true, protectionRank: 28, resourceAuthorization: true, description: 'Activate, retire, revoke, expire, and recover personal entitlements' }),
  definePermission('admin:permissions:manage', 'identity-access', 'role_permission', 'manage', 'critical', admins, { protected: true, protectionRank: 1, resourceAuthorization: true, description: 'Manage role permission assignments' }),
  definePermission('admin:auth:read', 'identity-access', 'auth_operation', 'read', 'high', moderators, { description: 'Read secret-free OAuth and logical session operations' }),
  definePermission('admin:auth:manage', 'identity-access', 'auth_operation', 'manage', 'critical', admins, { protected: true, protectionRank: 3, resourceAuthorization: true, description: 'Control OAuth providers and disposition or revoke logical sessions' }),
  definePermission('admin:users:read', 'user-profile', 'user', 'read', 'high', moderators, { description: 'Read bounded personal user lifecycle projections' }),
  definePermission('admin:users:manage', 'user-profile', 'user', 'manage', 'critical', admins, { protected: true, protectionRank: 29, resourceAuthorization: true, description: 'Suspend and restore personal users with lifecycle safeguards' }),
  definePermission('admin:notifications:read', 'notifications-webhooks', 'notification_operation', 'read', 'high', moderators, { description: 'Read notification templates, delivery metrics, channel controls, histories, and exports' }),
  definePermission('admin:notifications:manage', 'notifications-webhooks', 'notification_operation', 'manage', 'critical', admins, { protected: true, protectionRank: 30, resourceAuthorization: true, description: 'Manage notification templates, delivery recovery, and versioned channel controls' }),
  definePermission('admin:notifications:publish', 'notifications-webhooks', 'notification_template', 'publish', 'critical', admins, { protected: true, protectionRank: 31, resourceAuthorization: true, description: 'Publish, roll back, and test notification template versions' }),
  definePermission('admin:developer:read', 'developer-platform', 'service_account', 'read', 'high', moderators, { description: 'Read safe service account, API key lifecycle, and usage projections' }),
  definePermission('admin:developer:manage', 'developer-platform', 'developer_access_control', 'manage', 'critical', admins, { protected: true, protectionRank: 32, resourceAuthorization: true, description: 'Enable developer access and immediately revoke service accounts or API keys' }),
  definePermission('admin:webhooks:read', 'developer-platform', 'webhook_operation', 'read', 'high', moderators, { description: 'Read secret-free webhook subscriptions, delivery attempts, DLQ, and metrics' }),
  definePermission('admin:webhooks:manage', 'developer-platform', 'webhook_operation', 'manage', 'critical', admins, { protected: true, protectionRank: 33, resourceAuthorization: true, description: 'Control webhook availability, disable subscriptions, and replay dead-lettered deliveries' }),
  definePermission('admin:creative:cancel', 'ai-runtime', 'creative_generation', 'cancel', 'high', admins, { resourceAuthorization: true, description: 'Cancel eligible creative generations' }),
  definePermission('admin:creative:retry', 'ai-runtime', 'creative_generation', 'retry', 'critical', admins, { resourceAuthorization: true, description: 'Authorize retries for eligible creative generations' }),
  definePermission('admin:creative:replay', 'ai-runtime', 'creative_generation', 'replay', 'critical', admins, { resourceAuthorization: true, description: 'Request and approve safe manual Provider replay' }),
  definePermission('admin:creative:provider-control:read', 'model-control-plane', 'provider_control', 'read', 'high', admins, { description: 'Read Provider control state and evidence' }),
  definePermission('admin:creative:provider-control:manage', 'model-control-plane', 'provider_control', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Disable Provider controls and record cap evidence' }),
  definePermission('admin:creative:provider-control:recover', 'model-control-plane', 'provider_control', 'recover', 'critical', admins, { resourceAuthorization: true, description: 'Request and approve Provider recovery' }),
  definePermission('admin:model-control:read', 'model-control-plane', 'model_catalog', 'read', 'high', moderators, { description: 'Read the normalized Provider, model, version, deployment, capability, and pricing catalog' }),
  definePermission('admin:model-control:manage', 'model-control-plane', 'model_catalog', 'manage', 'critical', admins, { protected: true, protectionRank: 20, resourceAuthorization: true, description: 'Create and edit draft model control plane resources without enabling Provider traffic' }),
  definePermission('admin:model-control:transition', 'model-control-plane', 'model_catalog', 'transition', 'critical', admins, { protected: true, protectionRank: 21, resourceAuthorization: true, description: 'Apply audited model control plane lifecycle transitions' }),
  definePermission('admin:model-evaluations:read', 'ai-runtime', 'ai_evaluation', 'read', 'high', moderators, { description: 'Read immutable AI evaluation suites, policies, runs, and regression reports' }),
  definePermission('admin:model-evaluations:manage', 'ai-runtime', 'ai_evaluation', 'manage', 'critical', admins, { protected: true, protectionRank: 22, resourceAuthorization: true, description: 'Append reviewed AI evaluation suites and threshold policy versions' }),
  definePermission('admin:model-evaluations:execute', 'ai-runtime', 'ai_evaluation_run', 'execute', 'critical', admins, { protected: true, protectionRank: 23, resourceAuthorization: true, description: 'Record immutable scored evaluation runs used by promotion gates' }),
  definePermission('admin:provider-legal:read', 'compliance-data-rights', 'provider_legal_review', 'read', 'high', moderators, { description: 'Read immutable Provider legal and data-processing review evidence' }),
  definePermission('admin:provider-legal:manage', 'compliance-data-rights', 'provider_legal_review', 'manage', 'critical', admins, { protected: true, protectionRank: 24, resourceAuthorization: true, description: 'Append independently reviewed Provider legal approval or blocking evidence' }),
  definePermission('security:alerts:manage', 'trust-safety-risk', 'security_alert', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Acknowledge and silence security alerts' }),
  definePermission('admin:events:read', 'platform-architecture', 'domain_event', 'read', 'high', admins, { description: 'Read versioned domain event publication evidence' }),
  definePermission('admin:events:replay', 'platform-architecture', 'domain_event', 'replay', 'critical', admins, { resourceAuthorization: true, description: 'Request replay of a published or failed domain event' }),
  definePermission('admin:events:recover', 'platform-architecture', 'domain_event_consumption', 'recover', 'critical', admins, { resourceAuthorization: true, description: 'Retry dead-lettered event consumption or request compensation' }),
  definePermission('admin:jobs:read', 'jobs-automation', 'job_run', 'read', 'high', admins, { description: 'Read job definitions, runs, attempts, and safe results' }),
  definePermission('admin:jobs:manage', 'jobs-automation', 'job_run', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Cancel queued or running job runs' }),
  definePermission('admin:jobs:recover', 'jobs-automation', 'job_run', 'recover', 'critical', admins, { resourceAuthorization: true, description: 'Retry dead-lettered job runs and request safe manual reruns' }),
  definePermission('admin:jobs:schedule', 'jobs-automation', 'job_definition', 'schedule', 'critical', admins, { resourceAuthorization: true, description: 'Pause and resume registered scheduled job definitions' }),
  definePermission('admin:bulk-actions:manage', 'admin-console', 'admin_bulk_action', 'manage', 'critical', admins, { resourceAuthorization: true, description: 'Preview and confirm registered JobRun-backed admin bulk actions' }),
  definePermission('admin:high-risk:approve', 'identity-access', 'high_risk_approval', 'approve', 'critical', admins, { protected: true, protectionRank: 3, resourceAuthorization: true, description: 'Request and approve temporary high-risk access with two-person control' }),
  definePermission('admin:temporary-access:manage', 'identity-access', 'temporary_authorization', 'manage', 'critical', admins, { protected: true, protectionRank: 4, resourceAuthorization: true, description: 'List and revoke temporary administrative authorization grants' }),
  definePermission('admin:break-glass', 'identity-access', 'break_glass_access', 'manage', 'critical', admins, { protected: true, protectionRank: 5, resourceAuthorization: true, description: 'Activate and post-review emergency break-glass access' }),
  definePermission('admin:releases:read', 'platform-release', 'release_change', 'read', 'high', admins, { description: 'Read release changes and immutable deployment evidence' }),
  definePermission('admin:releases:manage', 'platform-release', 'release_change', 'manage', 'critical', admins, { protected: true, protectionRank: 6, resourceAuthorization: true, description: 'Request environment promotion, configuration, and SecretRef rotation changes' }),
  definePermission('admin:releases:approve', 'platform-release', 'release_change', 'approve', 'critical', admins, { protected: true, protectionRank: 7, resourceAuthorization: true, description: 'Approve or reject release changes with two-person control' }),
  definePermission('admin:releases:deploy', 'platform-release', 'release_change', 'deploy', 'critical', admins, { protected: true, protectionRank: 8, resourceAuthorization: true, description: 'Record deployment outcomes and execute versioned rollback' }),
  definePermission('admin:settings:read', 'config-feature-flags', 'system_setting', 'read', 'high', moderators, { description: 'Read registered system settings, revisions, and change evidence' }),
  definePermission('admin:settings:manage', 'config-feature-flags', 'system_setting_change', 'manage', 'critical', admins, { protected: true, protectionRank: 10, resourceAuthorization: true, description: 'Preview and request versioned system setting changes or rollbacks' }),
  definePermission('admin:settings:approve', 'config-feature-flags', 'system_setting_change', 'approve', 'critical', admins, { protected: true, protectionRank: 11, resourceAuthorization: true, description: 'Approve or reject system setting changes with two-person control' }),
  definePermission('admin:settings:publish', 'config-feature-flags', 'system_setting', 'publish', 'critical', admins, { protected: true, protectionRank: 12, resourceAuthorization: true, description: 'Publish approved system setting changes with independent execution' }),
  definePermission('admin:feature-flags:read', 'config-feature-flags', 'feature_flag', 'read', 'high', moderators, { description: 'Read feature flag definitions and immutable revisions' }),
  definePermission('admin:feature-flags:manage', 'config-feature-flags', 'feature_flag', 'manage', 'critical', admins, { protected: true, protectionRank: 13, resourceAuthorization: true, description: 'Create, edit, soft-delete, and restore feature flag definitions' }),
  definePermission('admin:feature-flags:publish', 'config-feature-flags', 'feature_flag', 'publish', 'critical', admins, { protected: true, protectionRank: 14, resourceAuthorization: true, description: 'Publish and roll back feature flag definitions' }),
  definePermission('admin:feature-flags:emergency', 'config-feature-flags', 'feature_flag', 'emergency', 'critical', admins, { protected: true, protectionRank: 15, resourceAuthorization: true, description: 'Immediately disable and restore a published feature flag independently of rollout rules' }),
  definePermission('admin:reference-data:read', 'config-feature-flags', 'reference_data', 'read', 'high', moderators, { description: 'Read reference data entries and immutable revisions' }),
  definePermission('admin:reference-data:manage', 'config-feature-flags', 'reference_data', 'manage', 'critical', admins, { protected: true, protectionRank: 16, resourceAuthorization: true, description: 'Create, edit, soft-delete, restore, and bulk-manage reference data' }),
  definePermission('admin:reference-data:publish', 'config-feature-flags', 'reference_data', 'publish', 'critical', admins, { protected: true, protectionRank: 17, resourceAuthorization: true, description: 'Publish and roll back reference data entries' }),
  definePermission('admin:announcements:read', 'config-feature-flags', 'announcement', 'read', 'high', moderators, { description: 'Read announcement drafts and immutable revisions' }),
  definePermission('admin:announcements:manage', 'config-feature-flags', 'announcement', 'manage', 'critical', admins, { protected: true, protectionRank: 18, resourceAuthorization: true, description: 'Create, edit, soft-delete, and restore announcements' }),
  definePermission('admin:announcements:publish', 'config-feature-flags', 'announcement', 'publish', 'critical', admins, { protected: true, protectionRank: 19, resourceAuthorization: true, description: 'Publish and roll back announcements' }),
])

export const permissions = Object.freeze(permissionRegistry.map(({ id }) => id))
export const permissionById = Object.freeze(Object.fromEntries(permissionRegistry.map((permission) => [permission.id, permission])))

export const rolePermissions = Object.freeze(Object.fromEntries(
  ['member', 'creator', 'publisher', 'moderator', 'admin'].map((role) => [
    role,
    Object.freeze(permissionRegistry.filter(({ defaultRoles }) => defaultRoles.includes(role)).map(({ id }) => id)),
  ]),
))

export const getPermissionsForRole = (role) => [...(rolePermissions[role] ?? [])]

export const mergePermissions = (...sets) => {
  const merged = new Set()
  for (const set of sets) {
    for (const permission of set ?? []) {
      if (permissionById[permission]) merged.add(permission)
    }
  }
  return [...merged]
}

export const hasPermission = (actor, permission) =>
  Boolean(actor && permissionById[permission] && Array.isArray(actor.permissions) && actor.permissions.includes(permission))

export const protectedRolePermissions = Object.freeze(Object.fromEntries(
  ['member', 'creator', 'publisher', 'moderator', 'admin'].map((role) => [
    role,
    Object.freeze(permissionRegistry.filter((permission) => permission.protected && permission.defaultRoles.includes(role)).sort((a, b) => a.protectionRank - b.protectionRank).map(({ id }) => id)),
  ]),
))

export const getProtectedRolePermissions = (role) => [...(protectedRolePermissions[role] ?? [])]
