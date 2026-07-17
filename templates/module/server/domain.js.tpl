export const {{camelName}}OperationPolicy = '{{operationPolicy}}'
export const {{camelName}}Model = '{{model}}'

export const assert{{pascalName}}Invariant = (value) => {
  // TODO(DX-SCAFFOLD): replace with the module's explicit state and value invariants.
  if (!value || typeof value !== 'object') throw new TypeError('{{pascalName}} value must be an object')
  return value
}
