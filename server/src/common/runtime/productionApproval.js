const productionRuntimeApproval = Symbol('productionRuntimeApproval')

export const attachProductionRuntimeApproval = (source, evidence) => {
  if (!source || typeof source !== 'object' || !evidence || typeof evidence !== 'object') {
    throw new Error('production runtime approval evidence is required')
  }
  Object.defineProperty(source, productionRuntimeApproval, {
    value: Object.freeze({ ...evidence }),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return source
}

export const readProductionRuntimeApproval = (source) => source?.[productionRuntimeApproval] ?? null
