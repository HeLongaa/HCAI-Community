import { domainEventConsumerHandlers } from './domainEventConsumerHandlers.js'
import { processDomainEventCompensationBatch, processDomainEventConsumerBatch } from './prismaDomainEventConsumerRepository.js'
import { publishDomainEventBatch } from './prismaDomainEventRepository.js'

export const runDomainEventPipelineOnce = async ({ repositories, workerId = 'domain-event-pipeline', limit = 50 }) => {
  const backfilled = await repositories.domainEventConsumers.backfillPublished(limit)
  const publications = await publishDomainEventBatch({
    repository: repositories.domainEvents,
    workerId,
    limit,
    publisher: (event) => repositories.domainEventConsumers.receive(event),
  })
  const consumptions = await processDomainEventConsumerBatch({ repository: repositories.domainEventConsumers, handlers: domainEventConsumerHandlers, workerId, limit })
  const compensations = await processDomainEventCompensationBatch({ repository: repositories.domainEventConsumers, handlers: domainEventConsumerHandlers, workerId, limit })
  return {
    backfilled,
    published: publications.filter((item) => item.status === 'published').length,
    publicationFailed: publications.filter((item) => item.status === 'failed').length,
    consumed: consumptions.filter((item) => item.status === 'succeeded').length,
    deadLettered: consumptions.filter((item) => item.status === 'dead_lettered').length,
    compensated: compensations.filter((item) => item.status === 'succeeded').length,
    compensationFailed: compensations.filter((item) => item.status === 'failed').length,
  }
}
