import { randomUUID } from 'node:crypto'

const log = (logger, level, message, details = null) => {
  const method = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : null
  if (!method) return
  if (details == null) {
    method(message)
  } else {
    method(message, details)
  }
}

const positiveSeconds = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const startLeaseRenewal = ({
  id,
  lease,
  leaseManager,
  token,
  logger,
}) => {
  if (!leaseManager?.renew || !token) {
    return null
  }
  const ttlSeconds = positiveSeconds(lease.ttlSeconds, 300)
  const renewIntervalSeconds = Math.min(
    positiveSeconds(lease.renewIntervalSeconds, Math.max(1, Math.floor(ttlSeconds / 2))),
    Math.max(1, ttlSeconds - 1),
  )
  const timer = setInterval(() => {
    void (async () => {
      try {
        const renewed = await leaseManager.renew({
          key: lease.key,
          token,
          ttlSeconds,
        })
        if (!renewed?.renewed) {
          log(logger, 'warn', `[worker:${id}] lease renewal failed`, renewed)
        }
      } catch (error) {
        log(logger, 'error', `[worker:${id}] lease renewal failed`, error)
      }
    })()
  }, renewIntervalSeconds * 1000)
  timer.unref?.()
  return timer
}

const runWithLease = async ({
  id,
  lease,
  leaseManager,
  workerId,
  logger,
  run,
}) => {
  if (!lease?.key || !leaseManager?.acquire) {
    return run()
  }
  const ttlSeconds = positiveSeconds(lease.ttlSeconds, 300)
  const acquired = await leaseManager.acquire({
    key: lease.key,
    ownerId: workerId,
    ttlSeconds,
    metadata: {
      jobId: id,
      ...(lease.metadata ?? {}),
    },
  })
  if (!acquired?.acquired) {
    log(logger, 'warn', `[worker:${id}] skipped because lease is held`, acquired)
    return {
      skipped: true,
      reason: 'lease_unavailable',
      lease: {
        key: lease.key,
        ownerId: acquired?.ownerId ?? null,
        expiresAt: acquired?.expiresAt ?? null,
      },
    }
  }

  const renewalTimer = startLeaseRenewal({
    id,
    lease,
    leaseManager,
    token: acquired.token,
    logger,
  })
  try {
    return await run()
  } finally {
    if (renewalTimer) {
      clearInterval(renewalTimer)
    }
    try {
      await leaseManager.release?.({
        key: lease.key,
        token: acquired.token,
      })
    } catch (error) {
      log(logger, 'error', `[worker:${id}] lease release failed`, error)
    }
  }
}

export const startIntervalWorkerJob = ({
  id,
  enabled = true,
  intervalSeconds = 60,
  lease = null,
  leaseManager = null,
  workerId = `worker-${randomUUID()}`,
  run,
  runImmediately = true,
  unrefTimers = true,
  logger = console,
} = {}) => {
  if (!enabled || typeof run !== 'function') {
    return null
  }
  const intervalMs = Math.max(1000, Number(intervalSeconds ?? 60) * 1000)
  let running = false
  const runOnce = async () => {
    if (running) {
      log(logger, 'warn', `[worker:${id}] skipped because the previous run is still active`)
      return { skipped: true }
    }
    running = true
    try {
      const result = await runWithLease({
        id,
        lease,
        leaseManager,
        workerId,
        logger,
        run,
      })
      log(logger, 'info', `[worker:${id}] completed`, result)
      return result
    } catch (error) {
      log(logger, 'error', `[worker:${id}] failed`, error)
      return null
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void runOnce()
  }, intervalMs)
  if (unrefTimers) {
    timer.unref?.()
  }
  const initialRun = runImmediately
    ? setTimeout(() => {
        void runOnce()
      }, 0)
    : null
  if (unrefTimers) {
    initialRun?.unref?.()
  }
  return {
    id,
    intervalMs,
    run: runOnce,
    stop: () => {
      clearInterval(timer)
      if (initialRun) {
        clearTimeout(initialRun)
      }
    },
  }
}

export const startWorkerJobs = (definitions = [], options = {}) => {
  const logger = options.logger ?? console
  const workerId = options.workerId ?? `worker-${randomUUID()}`
  const jobs = definitions
    .map((definition) => startIntervalWorkerJob({
      ...definition,
      logger: definition.logger ?? logger,
      leaseManager: definition.leaseManager ?? options.leaseManager,
      workerId: definition.workerId ?? workerId,
      unrefTimers: definition.unrefTimers ?? options.unrefTimers,
    }))
    .filter(Boolean)
  if (jobs.length === 0) {
    log(logger, 'warn', '[worker] no jobs enabled')
  } else {
    log(logger, 'info', '[worker] started jobs', jobs.map((job) => job.id))
  }
  return {
    jobs,
    stop: () => {
      for (const job of jobs) {
        job.stop()
      }
    },
    run: async (id) => {
      const job = jobs.find((entry) => entry.id === id)
      return job ? job.run() : null
    },
  }
}
