import { useState } from 'react'
import { BriefcaseBusiness, ChevronDown, FolderPlus, ImagePlus, LoaderCircle, Send } from 'lucide-react'
import { textFor } from '../../domain/utils'
import type { ApiTaskDeliveryTarget } from '../../services/contracts'
import { mediaService } from '../../services/mediaService'
import { taskService } from '../../services/taskService'

export function UseCreativeAsset({ t, assetId, fileName, available = true }: {
  t: Record<string, string>
  assetId: string
  fileName?: string
  available?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<ApiTaskDeliveryTarget[]>([])
  const [taskId, setTaskId] = useState('')
  const [content, setContent] = useState(fileName ? `Creative output delivery: ${fileName}` : 'Creative output delivery.')
  const [rightsNote, setRightsNote] = useState('I confirm that I have the rights required for this delivery.')
  const [targetsLoaded, setTargetsLoaded] = useState(false)
  const [busy, setBusy] = useState<'targets' | 'library' | 'portfolio' | 'task' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = () => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen || targetsLoaded) return
    setBusy('targets')
    taskService.deliveryTargets()
      .then((items) => {
        setTargets(items)
        setTaskId(items[0]?.id || '')
      })
      .catch(() => setTargets([]))
      .finally(() => {
        setTargetsLoaded(true)
        setBusy(null)
      })
  }

  const run = async (kind: 'library' | 'portfolio' | 'task') => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      if (kind === 'library') {
        await mediaService.saveAssetToLibrary(assetId)
        setNotice(textFor(t, 'Saved to your private library.', '已保存到私人素材库。'))
      } else if (kind === 'portfolio') {
        await mediaService.addAssetToPortfolio(assetId, { title: fileName || undefined })
        setNotice(textFor(t, 'Portfolio draft created.', '已创建作品集草稿。'))
      } else {
        if (!taskId) throw new Error(textFor(t, 'Select a task first.', '请先选择任务。'))
        await taskService.submit(taskId, content, { assetIds: [assetId], rightsNote })
        const remaining = targets.filter((task) => task.id !== taskId)
        setTargets(remaining)
        setTaskId(remaining[0]?.id || '')
        setNotice(textFor(t, 'Submitted with a frozen asset evidence snapshot.', '已提交，并冻结产物证据快照。'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : textFor(t, 'The action could not be completed.', '操作未能完成。'))
    } finally {
      setBusy(null)
    }
  }

  return <section className="use-creative-asset" data-testid={`use-creative-asset-${assetId}`}>
    <button className="use-creative-asset-toggle" disabled={!available} type="button" onClick={toggle}>
      <Send size={14}/><span>{textFor(t, 'Use output', '使用产物')}</span><ChevronDown className={open ? 'open' : ''} size={14}/>
    </button>
    {open && <div className="use-creative-asset-panel">
      <div className="use-creative-asset-quick-actions">
        <button disabled={busy !== null} type="button" onClick={() => void run('library')}>{busy === 'library' ? <LoaderCircle className="spin" size={14}/> : <FolderPlus size={14}/>} {textFor(t, 'Private library', '私人素材库')}</button>
        <button disabled={busy !== null} type="button" onClick={() => void run('portfolio')}>{busy === 'portfolio' ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>} {textFor(t, 'Portfolio draft', '作品集草稿')}</button>
      </div>
      <div className="use-creative-asset-task">
        <label><span><BriefcaseBusiness size={13}/> {textFor(t, 'Task delivery', '任务交付')}</span>
          <select aria-label={textFor(t, 'Delivery task', '交付任务')} disabled={busy === 'targets' || targets.length === 0} value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            {targets.length === 0 && <option value="">{busy === 'targets' ? textFor(t, 'Loading tasks…', '正在加载任务…') : textFor(t, 'No submit-ready tasks', '暂无可交付任务')}</option>}
            {targets.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.status}</option>)}
          </select>
        </label>
        <textarea aria-label={textFor(t, 'Delivery note', '交付说明')} value={content} onChange={(event) => setContent(event.target.value)}/>
        <input aria-label={textFor(t, 'Rights note', '权利说明')} value={rightsNote} onChange={(event) => setRightsNote(event.target.value)}/>
        <button className="primary-button" disabled={!taskId || !content.trim() || busy !== null} type="button" onClick={() => void run('task')}><Send size={14}/> {textFor(t, 'Submit to task', '提交到任务')}</button>
      </div>
      {notice && <p className="use-creative-asset-notice success">{notice}</p>}
      {error && <p className="use-creative-asset-notice error">{error}</p>}
    </div>}
  </section>
}
