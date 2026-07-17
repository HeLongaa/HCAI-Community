const notImplemented = () => {
  const error = new Error('{{displayName}} repository is not configured')
  error.code = 'MODULE_NOT_IMPLEMENTED'
  throw error
}

export const {{camelName}}Repository = Object.freeze({
  // TODO(DX-SCAFFOLD): inject seed and Prisma adapters behind this owning port.
  listForActor: notImplemented,
})
