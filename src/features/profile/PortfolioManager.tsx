import { useEffect, useState } from 'react'
import { Archive, Eye, EyeOff, Image, LoaderCircle, RotateCcw } from 'lucide-react'
import { textFor } from '../../domain/utils'
import type { ApiPortfolioAsset } from '../../services/contracts'
import { profileService } from '../../services/profileService'

export function PortfolioManager({ t }: { t: Record<string, string> }) {
  const [items, setItems] = useState<ApiPortfolioAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    profileService.ownPortfolio()
      .then(setItems)
      .catch((cause) => setError(cause instanceof Error ? cause.message : textFor(t, 'Could not load portfolio drafts.', '无法加载作品集草稿。')))
      .finally(() => setLoading(false))
  }, [t])

  const transition = async (item: ApiPortfolioAsset, action: 'publish' | 'withdraw' | 'archive' | 'restore') => {
    setBusy(item.id)
    setError(null)
    try {
      const updated = await profileService.updatePortfolioAsset(item.id, { action })
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'Portfolio action failed.', '作品集操作失败。'))
    } finally {
      setBusy(null)
    }
  }

  return <section className="portfolio-manager panel" data-testid="portfolio-manager">
    <header><div><span>{textFor(t, 'Private controls', '私密管理')}</span><h2>{textFor(t, 'Portfolio drafts', '作品集草稿')}</h2></div><small>{items.length}</small></header>
    {loading ? <div className="portfolio-manager-state"><LoaderCircle className="spin" size={18}/>{textFor(t, 'Loading portfolio…', '正在加载作品集…')}</div> : items.length === 0 ? <div className="portfolio-manager-state"><Image size={18}/>{textFor(t, 'Use a governed output to create your first draft.', '从受治理产物创建第一个草稿。')}</div> : <div className="portfolio-manager-list">
      {items.map((item) => <article key={item.id}>
        <div><strong>{item.title}</strong><span>{item.asset?.fileName ?? item.assetId}</span><small>{item.status}</small></div>
        <div>
          {(item.status === 'draft' || item.status === 'withdrawn') && <button disabled={busy === item.id} type="button" onClick={() => void transition(item, 'publish')}><Eye size={14}/>{textFor(t, 'Publish', '发布')}</button>}
          {item.status === 'published' && <button disabled={busy === item.id} type="button" onClick={() => void transition(item, 'withdraw')}><EyeOff size={14}/>{textFor(t, 'Withdraw', '撤下')}</button>}
          {item.status !== 'archived' && <button disabled={busy === item.id} type="button" onClick={() => void transition(item, 'archive')}><Archive size={14}/>{textFor(t, 'Archive', '归档')}</button>}
          {item.status === 'archived' && <button disabled={busy === item.id} type="button" onClick={() => void transition(item, 'restore')}><RotateCcw size={14}/>{textFor(t, 'Restore draft', '恢复草稿')}</button>}
        </div>
      </article>)}
    </div>}
    {error && <p className="use-creative-asset-notice error">{error}</p>}
  </section>
}
