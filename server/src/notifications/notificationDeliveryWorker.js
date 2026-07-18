import { createNotificationEmailClient } from './notificationDeliveries.js'

export const runNotificationDeliveryWorkerOnce = async ({
  repositories,
  source = process.env,
  emailClient = createNotificationEmailClient({ source }),
  workerId = `notification-delivery-${process.pid}`,
  limit = 25,
  leaseSeconds = 60,
} = {}) => {
  const claims = await repositories.notificationDeliveries.claim({ workerId, limit, leaseSeconds })
  const results = []
  for (const claim of claims) {
    let result
    if (claim.channel === 'email') {
      result = await emailClient.send(claim)
    } else {
      result = { outcome: 'permanent_failure', errorCode: 'CHANNEL_UNSUPPORTED' }
    }
    const completed = await repositories.notificationDeliveries.complete(claim.id, claim.leaseToken, result)
    results.push(completed)
  }
  return {
    claimed: claims.length,
    sent: results.filter((item) => item?.status === 'sent').length,
    retryScheduled: results.filter((item) => item?.status === 'retry_scheduled').length,
    deadLettered: results.filter((item) => item?.status === 'dead_lettered').length,
  }
}
