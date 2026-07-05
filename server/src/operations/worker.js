const log = (logger, level, message, details = null) => {
  const method = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : null
  if (!method) return
  if (details == null) {
    method(message)
  } else {
    method(message, details)
  }
}

export const startIntervalWorkerJob = ({
  id,
  enabled = true,
  intervalSeconds = 60,
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
      const result = await run()
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
  const jobs = definitions
    .map((definition) => startIntervalWorkerJob({
      ...definition,
      logger: definition.logger ?? logger,
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
