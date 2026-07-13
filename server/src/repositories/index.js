import { createPrismaRepository } from './prismaRepository.js'
import { configureSecurityEventStore } from '../security/securityEvents.js'
import { assertProductionPersistence, shouldLoadDemoRepository } from './runtimePolicy.js'

const createRepository = async () => {
  assertProductionPersistence()
  const seedRepository = shouldLoadDemoRepository()
    ? (await import('./seedRepository.js')).createSeedRepository()
    : null
  const prismaRepository = await createPrismaRepository(seedRepository)
  if (prismaRepository?.securityEvents?.record) {
    configureSecurityEventStore(prismaRepository.securityEvents)
  }
  if (prismaRepository) return prismaRepository
  if (seedRepository) return seedRepository
  throw new Error('PRODUCTION_DATABASE_UNAVAILABLE: Prisma repository could not be created')
}

export const repositories = await createRepository()
