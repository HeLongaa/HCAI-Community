import { createPrismaRepository } from './prismaRepository.js'
import { createSeedRepository } from './seedRepository.js'
import { configureSecurityEventStore } from '../security/securityEvents.js'

const createRepository = async () => {
  const seedRepository = createSeedRepository()
  const prismaRepository = await createPrismaRepository(seedRepository)
  if (prismaRepository?.securityEvents?.record) {
    configureSecurityEventStore(prismaRepository.securityEvents)
  }
  return prismaRepository ?? seedRepository
}

export const repositories = await createRepository()
