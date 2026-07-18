const versionedApiPathPattern = /^\/api\/(v[1-9][0-9]*)(?:\/|$)/

export const parseVersionedApiPath = (pathname) => {
  const match = String(pathname ?? '').match(versionedApiPathPattern)
  return match?.[1] ?? null
}

export const applyVersionedApiHeaders = (response, apiVersion) => {
  if (apiVersion) response.setHeader('x-api-version', apiVersion)
}

export const versionedApiMeta = (context, apiVersion) => ({ apiVersion, requestId: context.requestId })
