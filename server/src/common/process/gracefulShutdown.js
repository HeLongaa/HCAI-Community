const closeHttpServer = (server) => {
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
    server.closeIdleConnections?.()
  })
}

const normalizedTimeoutMs = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30_000
}

export const createGracefulShutdown = ({
  serviceName,
  server = null,
  workers = [],
  disconnect = null,
  timeoutMs = 30_000,
  logger = console,
  exit = (code) => process.exit(code),
} = {}) => {
  let shutdownPromise = null

  return (signal = 'shutdown') => {
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = new Promise((resolve) => {
      const deadlineMs = normalizedTimeoutMs(timeoutMs)
      let settled = false
      const finish = (code, result) => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        exit(code)
        resolve(result)
      }
      const deadline = setTimeout(() => {
        server?.closeAllConnections?.()
        logger.error?.(`[shutdown:${serviceName}] timed out after ${deadlineMs}ms`)
        finish(1, { drained: false, reason: 'timeout' })
      }, deadlineMs)

      logger.info?.(`[shutdown:${serviceName}] received ${signal}; draining`)
      void (async () => {
        try {
          const workerDrains = workers
            .filter(Boolean)
            .map((worker) => Promise.resolve(worker.stop?.({ timeoutMs: deadlineMs })))
          await Promise.all([closeHttpServer(server), ...workerDrains])
          await disconnect?.()
          logger.info?.(`[shutdown:${serviceName}] complete`)
          finish(0, { drained: true })
        } catch (error) {
          server?.closeAllConnections?.()
          logger.error?.(`[shutdown:${serviceName}] failed`, error)
          finish(1, { drained: false, reason: 'error', error })
        }
      })()
    })

    return shutdownPromise
  }
}
