export const startMediaScanWorker = (repositories, options = {}) => {
  if (!options.enabled || !repositories.media?.sweepScanJobs) {
    return null
  }
  const intervalMs = Math.max(1000, Number(options.intervalSeconds ?? 60) * 1000)
  let running = false
  const run = async () => {
    if (running) return null
    running = true
    try {
      return await repositories.media.sweepScanJobs({ source: 'worker' })
    } catch (error) {
      console.error('[media-scan-worker]', error)
      return null
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void run()
  }, intervalMs)
  timer.unref?.()
  const initialRun = setTimeout(() => {
    void run()
  }, 0)
  initialRun.unref?.()
  return {
    run,
    stop: () => {
      clearInterval(timer)
      clearTimeout(initialRun)
    },
  }
}
