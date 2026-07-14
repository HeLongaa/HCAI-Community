const policyActionMap = {
  mutable_crud: ['list', 'detail', 'create', 'update', 'softDelete', 'export'],
  state_transition: ['list', 'detail', 'transition', 'retry', 'cancel', 'export'],
  soft_delete: ['list', 'detail', 'archive', 'restore', 'export'],
  append_only: ['list', 'detail', 'export', 'registeredRecovery'],
  immutable_evidence: ['list', 'detail', 'export'],
}

const forbiddenActionMap = {
  append_only: ['create', 'update', 'delete', 'bulkMutate'],
  immutable_evidence: ['create', 'update', 'delete', 'bulkMutate'],
  state_transition: ['arbitraryUpdate', 'hardDelete'],
}

const routeValue = (value) => value || null

export const capabilitiesForOperationPolicy = (policy, { hardDelete = false } = {}) => {
  const allowed = new Set(policyActionMap[policy] ?? ['list', 'detail'])
  if (policy === 'mutable_crud' && hardDelete) allowed.add('hardDelete')
  return {
    allowed: [...allowed],
    forbidden: forbiddenActionMap[policy] ?? [],
  }
}

export const buildAdminResourceDescriptor = (resource, policy) => {
  const capabilities = capabilitiesForOperationPolicy(policy.policy, { hardDelete: policy.hardDelete })
  return {
    id: resource.id,
    model: resource.model,
    domain: policy.domain,
    operationPolicy: policy.policy,
    hardDelete: Boolean(policy.hardDelete),
    routes: {
      list: routeValue(resource.listRoute),
      detail: routeValue(resource.detailRoute),
      export: routeValue(resource.exportRoute),
      mutations: resource.mutationRoutes ?? [],
      recovery: resource.recoveryRoutes ?? [],
    },
    capabilities,
  }
}

export const buildAdminResourceRegistry = ({ resources = [], policies = [] } = {}) => {
  const byModel = new Map(policies.map((policy) => [policy.model, policy]))
  return resources.map((resource) => {
    const policy = byModel.get(resource.model)
    if (!policy) throw new Error(`ADMIN_RESOURCE_POLICY_MISSING:${resource.model}`)
    return buildAdminResourceDescriptor(resource, policy)
  })
}

