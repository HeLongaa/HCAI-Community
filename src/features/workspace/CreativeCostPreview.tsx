import { useEffect, useState } from 'react'
import { CircleDollarSign, Gauge } from 'lucide-react'

import { textFor } from '../../domain/utils'
import { creativeService } from '../../services/creativeService'
import type { ApiCreativeAccountingPreview, CreativeWorkspace } from '../../services/contracts'

export function CreativeCostPreview({
  t,
  workspace,
  mode,
  providerId,
  parameters = {},
}: {
  t: Record<string, string>
  workspace: CreativeWorkspace
  mode: string
  providerId?: string | null
  parameters?: { aspectRatio?: string; quality?: string }
}) {
  const aspectRatio = parameters.aspectRatio
  const quality = parameters.quality
  const requestKey = `${workspace}:${mode}:${providerId ?? ''}:${aspectRatio ?? ''}:${quality ?? ''}`
  const [result, setResult] = useState<{
    key: string
    preview: ApiCreativeAccountingPreview | null
    error: boolean
  }>({ key: '', preview: null, error: false })

  useEffect(() => {
    if (!mode) return
    let active = true
    creativeService.accountingPreview(workspace, mode, providerId, { aspectRatio, quality }).then((result) => {
      if (!active) return
      setResult({ key: requestKey, preview: result, error: false })
    }).catch(() => {
      if (active) setResult({ key: requestKey, preview: null, error: true })
    })
    return () => { active = false }
  }, [aspectRatio, mode, providerId, quality, requestKey, workspace])

  if (result.key !== requestKey) {
    return <div className="creative-cost-preview loading">{textFor(t, 'Loading cost and limit…', '正在读取积分与限额…')}</div>
  }
  if (result.error || !result.preview) {
    return <div className="creative-cost-preview unavailable">{textFor(t, 'Cost and limit preview unavailable.', '积分与限额预览暂不可用。')}</div>
  }
  const preview = result.preview
  const reset = new Date(preview.quota.window.resetsAt)
  const resetLabel = Number.isNaN(reset.getTime()) ? '-' : reset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const providerCostLabel = preview.providerCost.availability === 'available' && preview.providerCost.estimateAmount != null
    ? `${textFor(t, 'Provider cost:', '提供方成本：')} ${preview.providerCost.currency ?? 'USD'} ${preview.providerCost.estimateAmount.toFixed(6)}`
    : textFor(t, 'Provider cost: unavailable', '提供方成本：不可用')
  return (
    <div className={`creative-cost-preview ${preview.quota.allowed ? '' : 'blocked'}`} data-testid={`creative-cost-${workspace}`}>
      <span><CircleDollarSign size={15} /><strong>{preview.credits.estimate}</strong> {textFor(t, 'credits estimated', '积分预估')}</span>
      <span><Gauge size={15} /><strong>{preview.quota.weight}</strong> {textFor(t, 'quota units', '限额单位')} · {textFor(t, 'remaining', '剩余')} {preview.quota.remaining}/{preview.quota.limit}</span>
      <small>{providerCostLabel}</small>
      <small>{textFor(t, 'Usage resets at', '使用额度重置于')} {resetLabel}</small>
    </div>
  )
}
