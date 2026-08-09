const normalizeEnvironment = (value) => String(value ?? '').trim().toLowerCase()

export const isProductionEnvironment = (source = process.env) => (
  normalizeEnvironment(source.NODE_ENV) === 'production' ||
  normalizeEnvironment(source.DEPLOYMENT_ENV) === 'production'
)
