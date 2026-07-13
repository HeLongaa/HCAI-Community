export const isProductionRuntime = (env = process.env) => env.NODE_ENV === 'production'

export const shouldLoadDemoRepository = (env = process.env) => !isProductionRuntime(env)

export const shouldAutoSeedPrisma = (env = process.env) =>
  !isProductionRuntime(env) && env.DEMO_DATABASE_AUTOSEED !== 'false'

export const assertProductionPersistence = (env = process.env) => {
  if (isProductionRuntime(env) && !String(env.DATABASE_URL ?? '').trim()) {
    throw new Error('PRODUCTION_DATABASE_REQUIRED: DATABASE_URL must be configured; Seed fallback is disabled')
  }
}
