import { {{camelName}}Repository } from './repositoryPort.js'

export const list{{pascalName}} = async ({ actor }) => {
  // TODO(DX-SCAFFOLD): apply owner authorization and return a bounded redacted read model.
  return {{camelName}}Repository.listForActor(actor)
}
