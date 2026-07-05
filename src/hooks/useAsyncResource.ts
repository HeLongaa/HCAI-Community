import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import type { AsyncResourceState } from '../domain/types'

type UseAsyncResourceOptions<T> = {
  load: () => Promise<T>
  onSuccess: (data: T) => void
  getErrorMessage: () => string
  deps?: DependencyList
  auto?: boolean
  logLabel?: string
}

export function useAsyncResource<T>({
  load,
  onSuccess,
  getErrorMessage,
  deps = [],
  auto = true,
  logLabel = 'async-resource',
}: UseAsyncResourceOptions<T>): AsyncResourceState {
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      const data = await load()
      if (mountedRef.current && requestIdRef.current === requestId) onSuccess(data)
    } catch (resourceError) {
      console.info(`[${logLabel}]`, resourceError)
      if (mountedRef.current && requestIdRef.current === requestId) setError(getErrorMessage())
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps)

  useEffect(() => {
    if (auto) void refresh()
  }, [auto, refresh])

  return {
    loading,
    error,
    refresh,
  }
}
