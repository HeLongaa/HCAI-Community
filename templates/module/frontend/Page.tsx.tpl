import { useEffect, useState } from 'react'

import { {{camelName}}Service } from '../../services/{{camelName}}Service'
import type { {{pascalName}}Record } from '../../services/{{camelName}}Contracts'

export function {{pascalName}}Page() {
  const [items, setItems] = useState<{{pascalName}}Record[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void {{camelName}}Service.list()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '{{displayName}} could not be loaded'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main aria-labelledby="{{camelName}}-title">
      <h1 id="{{camelName}}-title">{{displayName}}</h1>
      {loading ? <p aria-live="polite">Loading...</p> : error ? <p role="alert">{error}</p> : items.length === 0 ? <p>No records yet.</p> : <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>}
    </main>
  )
}
