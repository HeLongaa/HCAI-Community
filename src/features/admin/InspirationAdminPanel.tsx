import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  FilePlus2,
  History,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Settings2,
  Tags,
  X,
} from 'lucide-react'
import type { ApiInspirationCategory, ApiInspirationEntry, InspirationSubmissionRequest } from '../../services/contracts'
import { adminService } from '../../services/adminService'
import { AdminActionFeedback, type AdminActionFeedbackMessage } from './AdminActionFeedback'

const statuses = ['all', 'pending_review', 'published', 'draft', 'changes_requested', 'rejected', 'archived']
const contentLines = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n') : ''
const statusMatches = (entry: ApiInspirationEntry, status: string) => status === 'all'
  || entry.status === status
  || (status === 'pending_review' && entry.pendingRevision?.status === 'pending_review')

export function InspirationAdminPanel({ isZh, canRead, canManage }: { isZh: boolean; canRead: boolean; canManage: boolean }) {
  const [entries, setEntries] = useState<ApiInspirationEntry[]>([])
  const [categories, setCategories] = useState<ApiInspirationCategory[]>([])
  const [status, setStatus] = useState('pending_review')
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)
  const [composer, setComposer] = useState<'content' | 'category' | 'categories' | null>(null)
  const [reviewing, setReviewing] = useState<ApiInspirationEntry | null>(null)
  const [editing, setEditing] = useState<ApiInspirationEntry | null>(null)
  const [historyEntry, setHistoryEntry] = useState<ApiInspirationEntry | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [rollbackNote, setRollbackNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async () => {
    if (!canRead) return
    setLoading(true)
    setReadError(null)
    try {
      const [nextEntries, nextCategories] = await Promise.all([
        adminService.inspirationEntries(status),
        adminService.inspirationCategories(),
      ])
      setEntries(nextEntries)
      setCategories(nextCategories)
    } catch {
      setReadError(isZh ? '灵感库后台数据暂时无法加载。' : 'Inspiration administration data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canRead) return undefined
    let cancelled = false
    void Promise.resolve().then(async () => {
      if (cancelled) return
      setLoading(true)
      setReadError(null)
      try {
        const [nextEntries, nextCategories] = await Promise.all([
          adminService.inspirationEntries(status),
          adminService.inspirationCategories(),
        ])
        if (!cancelled) {
          setEntries(nextEntries)
          setCategories(nextCategories)
        }
      } catch {
        if (!cancelled) setReadError(isZh ? '灵感库后台数据暂时无法加载。' : 'Inspiration administration data could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [canRead, isZh, status])

  const replace = (next: ApiInspirationEntry) => {
    setEntries((current) => current.map((item) => item.id === next.id ? next : item).filter((item) => statusMatches(item, status)))
    if (historyEntry?.id === next.id) setHistoryEntry(next)
    if (editing?.id === next.id) setEditing(next)
  }

  const review = async (decision: 'approve' | 'request_changes' | 'reject') => {
    if (!reviewing) return
    if (decision !== 'approve' && !reviewNote.trim()) {
      setFeedback({ kind: 'error', text: isZh ? '要求修改或拒绝时必须填写原因。' : 'A reason is required for changes or rejection.' })
      return
    }
    setBusy(reviewing.id)
    setFeedback(null)
    try {
      replace(await adminService.reviewInspiration(reviewing.id, decision, reviewNote.trim()))
      setReviewing(null)
      setReviewNote('')
      setFeedback({ kind: 'success', text: isZh ? '审核结果已写入数据库。' : 'The review decision was saved.' })
    } catch {
      setFeedback({ kind: 'error', text: isZh ? '审核没有保存，请重试。' : 'The review was not saved. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  const archive = async (entry: ApiInspirationEntry, archived: boolean) => {
    setBusy(entry.id)
    setFeedback(null)
    try {
      replace(await adminService.setInspirationArchived(entry.id, archived))
      setFeedback({ kind: 'success', text: isZh ? '内容状态已更新。' : 'Content status updated.' })
    } catch {
      setFeedback({ kind: 'error', text: isZh ? '状态没有更新。' : 'The status was not updated.' })
    } finally {
      setBusy(null)
    }
  }

  const rollback = async (entry: ApiInspirationEntry, version: number) => {
    setBusy(`rollback-${entry.id}`)
    setFeedback(null)
    try {
      const next = await adminService.rollbackInspiration(entry.id, version, rollbackNote.trim())
      replace(next)
      setHistoryEntry(next)
      setRollbackNote('')
      setFeedback({ kind: 'success', text: isZh ? `已将 v${version} 的内容恢复为新版本。` : `Version ${version} was restored as a new version.` })
    } catch {
      setFeedback({ kind: 'error', text: isZh ? '版本没有恢复，请重试。' : 'The version was not restored.' })
    } finally {
      setBusy(null)
    }
  }

  const pendingCount = useMemo(
    () => entries.filter((item) => item.status === 'pending_review' || item.pendingRevision?.status === 'pending_review').length,
    [entries],
  )

  if (!canRead) return <section className="panel inspiration-admin-panel"><h2>{isZh ? '灵感库' : 'Inspiration Library'}</h2><p>{isZh ? '当前账号没有查看灵感库后台的权限。' : 'This account cannot access inspiration administration.'}</p></section>

  return (
    <section className="panel inspiration-admin-panel" data-testid="admin-inspiration">
      <header>
        <div><span>{isZh ? '内容与审核' : 'CONTENT & REVIEW'}</span><h2>{isZh ? '灵感库管理' : 'Inspiration Library'}</h2><p>{isZh ? '管理官方内容、用户投稿、分类、精选和版本。' : 'Manage official content, submissions, categories, curation, and versions.'}</p></div>
        {canManage && (
          <div className="inspiration-admin-actions">
            <button type="button" onClick={() => { setFeedback(null); setComposer(composer === 'categories' ? null : 'categories') }}><Settings2 size={16}/>{isZh ? '分类管理' : 'Categories'}</button>
            <button type="button" onClick={() => { setFeedback(null); setComposer(composer === 'category' ? null : 'category') }}><Tags size={16}/>{isZh ? '新建分类' : 'New category'}</button>
            <button className="primary" type="button" onClick={() => { setFeedback(null); setComposer(composer === 'content' ? null : 'content') }}><FilePlus2 size={16}/>{isZh ? '发布官方内容' : 'Publish official'}</button>
          </div>
        )}
      </header>

      <AdminActionFeedback message={readError ? { kind: 'error', text: readError } : null} className="inspiration-admin-read-feedback" />
      <AdminActionFeedback message={feedback} className="inspiration-admin-operation-feedback" />
      {composer === 'category' && <CategoryComposer isZh={isZh} onCreated={(category) => { setCategories((current) => [...current, category]); setComposer('categories'); setFeedback({ kind: 'success', text: isZh ? '分类已写入数据库。' : 'Category saved.' }) }} onError={(text) => setFeedback({ kind: 'error', text })} />}
      {composer === 'categories' && <CategoryManager isZh={isZh} categories={categories} onUpdated={(category) => setCategories((current) => current.map((item) => item.id === category.id ? category : item))} onFeedback={setFeedback} />}
      {composer === 'content' && <ContentComposer isZh={isZh} categories={categories.filter((item) => item.active)} onSaved={(entry) => { setEntries((current) => statusMatches(entry, status) ? [entry, ...current] : current); setComposer(null); setFeedback({ kind: 'success', text: isZh ? '官方内容已发布。' : 'Official content published.' }) }} onError={(text) => setFeedback({ kind: 'error', text })} />}

      <div className="inspiration-admin-toolbar">
        <label><span>{isZh ? '状态' : 'Status'}</span><select value={status} onChange={(event) => { setFeedback(null); setStatus(event.target.value) }}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select><ChevronDown size={15}/></label>
        <span>{status === 'pending_review' ? `${pendingCount} ${isZh ? '条待审核' : 'pending'}` : `${entries.length} ${isZh ? '条内容' : 'items'}`}</span>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? <LoaderCircle className="spin" size={16}/> : <RotateCcw size={16}/>}</button>
      </div>
      <div className="inspiration-admin-list">
        {loading ? <div className="inspiration-state"><LoaderCircle className="spin" size={18}/>{isZh ? '加载中' : 'Loading'}</div> : entries.length === 0 ? <div className="inspiration-empty"><strong>{isZh ? '当前筛选没有内容' : 'No content in this view'}</strong><span>{isZh ? '这里显示数据库中的真实内容与审核状态。' : 'This view reflects real database and review state.'}</span></div> : entries.map((entry) => {
          const reviewRevision = entry.pendingRevision?.status === 'pending_review'
          return (
            <article key={entry.id}>
              <div>
                <small>{entry.category ? (isZh ? entry.category.nameZh : entry.category.nameEn) : entry.contentType} · {entry.sourceKind === 'official' ? (isZh ? '官方' : 'Official') : (isZh ? '用户投稿' : 'Community')}{reviewRevision ? (isZh ? ' · 新版待审核' : ' · Revision pending') : ''}</small>
                <strong>{reviewRevision && typeof entry.pendingRevision?.snapshot?.title === 'string' ? entry.pendingRevision.snapshot.title : entry.title}</strong>
                <p>{reviewRevision && typeof entry.pendingRevision?.snapshot?.summary === 'string' ? entry.pendingRevision.snapshot.summary : entry.summary}</p>
                <span>{entry.author?.displayName ?? '-'} · v{reviewRevision ? entry.pendingRevision?.version : entry.version} · {new Date(entry.updatedAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}</span>
              </div>
              <div className="inspiration-admin-row-actions">
                {(entry.status === 'pending_review' || reviewRevision) && canManage && <button className="primary" type="button" onClick={() => { setFeedback(null); setReviewing(entry); setReviewNote('') }}>{isZh ? '审核' : 'Review'}</button>}
                {['published', 'archived'].includes(entry.status) && !entry.pendingRevision && canManage && <button type="button" onClick={() => { setFeedback(null); setEditing(entry) }}><Pencil size={15}/>{isZh ? '编辑' : 'Edit'}</button>}
                {entry.revisions && entry.revisions.length > 0 && <button type="button" onClick={() => { setFeedback(null); setHistoryEntry(entry) }}><History size={15}/>{isZh ? '版本' : 'Versions'}</button>}
                {entry.status === 'published' && canManage && <button type="button" onClick={() => void archive(entry, true)} disabled={busy === entry.id}><Archive size={15}/>{isZh ? '下架' : 'Archive'}</button>}
                {entry.status === 'archived' && canManage && <button type="button" onClick={() => void archive(entry, false)} disabled={busy === entry.id}><RotateCcw size={15}/>{isZh ? '恢复' : 'Restore'}</button>}
              </div>
            </article>
          )
        })}
      </div>

      {reviewing && <ReviewSheet isZh={isZh} entry={reviewing} note={reviewNote} setNote={setReviewNote} busy={busy === reviewing.id} feedback={feedback?.kind === 'error' ? feedback : null} onClose={() => setReviewing(null)} onReview={(decision) => void review(decision)} />}
      {editing && <EditorSheet isZh={isZh} entry={editing} categories={categories.filter((item) => item.active)} onClose={() => setEditing(null)} onSaved={(entry) => { replace(entry); setEditing(null); setFeedback({ kind: 'success', text: isZh ? '内容已保存为新版本。' : 'Content saved as a new version.' }) }} />}
      {historyEntry && <HistorySheet isZh={isZh} entry={historyEntry} canManage={canManage} note={rollbackNote} setNote={setRollbackNote} busy={busy === `rollback-${historyEntry.id}`} feedback={feedback?.kind === 'error' ? feedback : null} onClose={() => setHistoryEntry(null)} onRollback={(version) => void rollback(historyEntry, version)} />}
    </section>
  )
}

function CategoryComposer({ isZh, onCreated, onError }: { isZh: boolean; onCreated: (category: ApiInspirationCategory) => void; onError: (error: string) => void }) {
  const [form, setForm] = useState({ kind: 'content_type' as ApiInspirationCategory['kind'], slug: '', nameEn: '', nameZh: '', description: '', sortOrder: 70 })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try { onCreated(await adminService.createInspirationCategory(form)) }
    catch { onError(isZh ? '分类没有保存。' : 'Category was not saved.') }
  }
  return (
    <form className="inspiration-admin-composer" onSubmit={(event) => void submit(event)}>
      <label><span>{isZh ? '分类用途' : 'Kind'}</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as typeof form.kind })}><option value="content_type">content type</option><option value="domain">domain</option><option value="difficulty">difficulty</option></select></label>
      <label><span>Slug</span><input required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })}/></label>
      <label><span>English</span><input required value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })}/></label>
      <label><span>中文</span><input required value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })}/></label>
      <label><span>{isZh ? '顺序' : 'Order'}</span><input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}/></label>
      <label className="wide"><span>{isZh ? '说明' : 'Description'}</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <button className="primary" type="submit">{isZh ? '保存分类' : 'Save category'}</button>
    </form>
  )
}

function CategoryManager({ isZh, categories, onUpdated, onFeedback }: { isZh: boolean; categories: ApiInspirationCategory[]; onUpdated: (category: ApiInspirationCategory) => void; onFeedback: (message: AdminActionFeedbackMessage | null) => void }) {
  return (
    <div className="inspiration-category-manager">
      <div className="inspiration-category-manager-head"><span>{isZh ? '分类' : 'Category'}</span><span>Slug</span><span>{isZh ? '排序' : 'Order'}</span><span>{isZh ? '替代分类（停用时）' : 'Replacement on deactivate'}</span><span /></div>
      {categories.map((category) => <CategoryRow key={category.id} isZh={isZh} category={category} categories={categories} onUpdated={onUpdated} onFeedback={onFeedback} />)}
    </div>
  )
}

function CategoryRow({ isZh, category, categories, onUpdated, onFeedback }: { isZh: boolean; category: ApiInspirationCategory; categories: ApiInspirationCategory[]; onUpdated: (category: ApiInspirationCategory) => void; onFeedback: (message: AdminActionFeedbackMessage | null) => void }) {
  const [form, setForm] = useState({ nameEn: category.nameEn, nameZh: category.nameZh, slug: category.slug, sortOrder: category.sortOrder, replacementCategoryId: '' })
  const [busy, setBusy] = useState(false)
  const save = async (active = category.active) => {
    setBusy(true)
    onFeedback(null)
    try {
      const next = await adminService.updateInspirationCategory(category.id, {
        nameEn: form.nameEn,
        nameZh: form.nameZh,
        slug: form.slug,
        sortOrder: form.sortOrder,
        active,
        replacementCategoryId: !active ? form.replacementCategoryId || null : undefined,
      })
      onUpdated(next)
      onFeedback({ kind: 'success', text: isZh ? '分类设置已保存。' : 'Category settings saved.' })
    } catch {
      onFeedback({ kind: 'error', text: isZh ? '分类没有保存；如果仍有内容引用，请先选择替代分类。' : 'Category was not saved. Choose a replacement if content still references it.' })
    } finally {
      setBusy(false)
    }
  }
  const replacements = categories.filter((item) => item.id !== category.id && item.kind === category.kind && item.active)
  return (
    <div className={`inspiration-category-row ${category.active ? '' : 'is-inactive'}`}>
      <div><input value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })}/><input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })}/></div>
      <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })}/>
      <input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}/>
      <select value={form.replacementCategoryId} onChange={(event) => setForm({ ...form, replacementCategoryId: event.target.value })}><option value="">{isZh ? '无引用时可留空' : 'Optional when unused'}</option>{replacements.map((item) => <option key={item.id} value={item.id}>{isZh ? item.nameZh : item.nameEn}</option>)}</select>
      <div><button type="button" onClick={() => void save()} disabled={busy}>{isZh ? '保存' : 'Save'}</button><button type="button" onClick={() => void save(!category.active)} disabled={busy}>{category.active ? (isZh ? '停用' : 'Deactivate') : (isZh ? '启用' : 'Activate')}</button></div>
    </div>
  )
}

type ContentForm = {
  title: string
  summary: string
  problem: string
  audience: string
  categoryId: string
  domains: string
  difficulty: ApiInspirationEntry['difficulty']
  toolModels: string
  prerequisites: string
  steps: string
  inputs: string
  outputs: string
  examples: string
  mistakes: string
  sourceAttribution: string
  license: string
  featured: boolean
  supportsTaskDraft: boolean
  sortOrder: number
}

const contentForm = (entry?: ApiInspirationEntry | null): ContentForm => ({
  title: entry?.title ?? '',
  summary: entry?.summary ?? '',
  problem: entry?.problem ?? '',
  audience: entry?.audience ?? '',
  categoryId: entry?.category?.id ?? '',
  domains: entry?.domains.join(', ') ?? '',
  difficulty: entry?.difficulty ?? 'beginner',
  toolModels: entry?.toolModels.join(', ') ?? '',
  prerequisites: contentLines(entry?.content.prerequisites),
  steps: contentLines(entry?.content.steps),
  inputs: contentLines(entry?.content.inputs),
  outputs: contentLines(entry?.content.outputs),
  examples: contentLines(entry?.content.examples),
  mistakes: contentLines(entry?.content.mistakes),
  sourceAttribution: entry?.sourceAttribution ?? '',
  license: entry?.license ?? '',
  featured: entry?.featured ?? false,
  supportsTaskDraft: entry?.supportsTaskDraft ?? false,
  sortOrder: entry ? Number((entry as ApiInspirationEntry & { sortOrder?: number }).sortOrder ?? 0) : 0,
})

const requestFromForm = (form: ContentForm, categories: ApiInspirationCategory[]): InspirationSubmissionRequest & { featured: boolean; supportsTaskDraft: boolean; sortOrder: number } => {
  const contentCategories = categories.filter((item) => item.kind === 'content_type')
  return ({
  title: form.title,
  summary: form.summary,
  problem: form.problem,
  audience: form.audience,
  categoryId: form.categoryId || contentCategories[0]?.id || '',
  contentType: contentCategories.find((item) => item.id === (form.categoryId || contentCategories[0]?.id))?.slug ?? 'skills',
  domains: form.domains.split(',').map((item) => item.trim()).filter(Boolean),
  difficulty: form.difficulty,
  toolModels: form.toolModels.split(',').map((item) => item.trim()).filter(Boolean),
  content: {
    prerequisites: form.prerequisites.split('\n').map((item) => item.trim()).filter(Boolean),
    steps: form.steps.split('\n').map((item) => item.trim()).filter(Boolean),
    inputs: form.inputs.split('\n').map((item) => item.trim()).filter(Boolean),
    outputs: form.outputs.split('\n').map((item) => item.trim()).filter(Boolean),
    examples: form.examples.split('\n').map((item) => item.trim()).filter(Boolean),
    mistakes: form.mistakes.split('\n').map((item) => item.trim()).filter(Boolean),
  },
  sourceAttribution: form.sourceAttribution || null,
  license: form.license || null,
  featured: form.featured,
  supportsTaskDraft: form.supportsTaskDraft,
  sortOrder: form.sortOrder,
  })
}

function ContentFormFields({ isZh, categories, form, setForm }: { isZh: boolean; categories: ApiInspirationCategory[]; form: ContentForm; setForm: (next: ContentForm) => void }) {
  const contentCategories = categories.filter((item) => item.kind === 'content_type')
  const domainCategories = categories.filter((item) => item.kind === 'domain')
  const difficultyCategories = categories.filter((item) => item.kind === 'difficulty')
  const selectedDomains = form.domains.split(',').map((item) => item.trim()).filter(Boolean)
  const categoryId = form.categoryId || contentCategories[0]?.id || ''
  const toggleDomain = (slug: string, checked: boolean) => setForm({
    ...form,
    domains: (checked ? [...selectedDomains, slug] : selectedDomains.filter((item) => item !== slug)).join(', '),
  })
  return (
    <>
      <label><span>{isZh ? '标题' : 'Title'}</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label><span>{isZh ? '类型' : 'Type'}</span><select required value={categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{contentCategories.map((category) => <option key={category.id} value={category.id}>{isZh ? category.nameZh : category.nameEn}</option>)}</select></label>
      <label className="wide"><span>{isZh ? '简介' : 'Summary'}</span><textarea required rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })}/></label>
      <label className="wide"><span>{isZh ? '解决的问题' : 'Problem'}</span><textarea required rows={3} value={form.problem} onChange={(event) => setForm({ ...form, problem: event.target.value })}/></label>
      <label className="wide"><span>{isZh ? '适合人群' : 'Audience'}</span><textarea required rows={2} value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}/></label>
      <fieldset className="wide inspiration-admin-domain-options"><legend>{isZh ? '适用领域' : 'Domains'}</legend><div>{domainCategories.map((category) => <label key={category.id}><input type="checkbox" checked={selectedDomains.includes(category.slug)} onChange={(event) => toggleDomain(category.slug, event.target.checked)}/>{isZh ? category.nameZh : category.nameEn}</label>)}</div></fieldset>
      <label><span>{isZh ? '难度' : 'Difficulty'}</span><select value={form.difficulty || difficultyCategories[0]?.slug || ''} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>{difficultyCategories.map((category) => <option key={category.id} value={category.slug}>{isZh ? category.nameZh : category.nameEn}</option>)}</select></label>
      <label className="wide"><span>{isZh ? '工具或模型（逗号分隔）' : 'Tools or models'}</span><input value={form.toolModels} onChange={(event) => setForm({ ...form, toolModels: event.target.value })}/></label>
      {(['prerequisites', 'steps', 'inputs', 'outputs', 'examples', 'mistakes'] as const).map((field) => <label className="wide" key={field}><span>{({ prerequisites: isZh ? '前置条件' : 'Prerequisites', steps: isZh ? '步骤（每行一步）' : 'Steps', inputs: isZh ? '输入' : 'Inputs', outputs: isZh ? '输出' : 'Outputs', examples: isZh ? '示例' : 'Examples', mistakes: isZh ? '常见错误' : 'Common mistakes' })[field]}</span><textarea required={field === 'steps' || field === 'outputs'} rows={field === 'steps' ? 5 : 3} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })}/></label>)}
      <label><span>{isZh ? '来源' : 'Source'}</span><input value={form.sourceAttribution} onChange={(event) => setForm({ ...form, sourceAttribution: event.target.value })}/></label>
      <label><span>{isZh ? '授权' : 'License'}</span><input value={form.license} onChange={(event) => setForm({ ...form, license: event.target.value })}/></label>
      <label><span>{isZh ? '排序' : 'Order'}</span><input type="number" min="0" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}/></label>
      <label className="inspiration-admin-check"><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })}/>{isZh ? '设为精选' : 'Featured'}</label>
      <label className="inspiration-admin-check"><input type="checkbox" checked={form.supportsTaskDraft} onChange={(event) => setForm({ ...form, supportsTaskDraft: event.target.checked })}/>{isZh ? '允许创建任务草稿' : 'Supports task draft'}</label>
    </>
  )
}

function ContentComposer({ isZh, categories, onSaved, onError }: { isZh: boolean; categories: ApiInspirationCategory[]; onSaved: (entry: ApiInspirationEntry) => void; onError: (error: string) => void }) {
  const [form, setForm] = useState(contentForm())
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try { onSaved(await adminService.createOfficialInspiration(requestFromForm(form, categories))) }
    catch { onError(isZh ? '官方内容没有发布，请检查必填项。' : 'Official content was not published. Check required fields.') }
  }
  return <form className="inspiration-admin-composer inspiration-admin-content-composer" onSubmit={(event) => void submit(event)}><ContentFormFields isZh={isZh} categories={categories} form={form} setForm={setForm}/><button className="primary" type="submit">{isZh ? '发布官方内容' : 'Publish official content'}</button></form>
}

function ReviewSheet({ isZh, entry, note, setNote, busy, feedback, onClose, onReview }: { isZh: boolean; entry: ApiInspirationEntry; note: string; setNote: (value: string) => void; busy: boolean; feedback: AdminActionFeedbackMessage | null; onClose: () => void; onReview: (decision: 'approve' | 'request_changes' | 'reject') => void }) {
  const snapshot = entry.pendingRevision?.snapshot
  const title = snapshot?.title ?? entry.title
  const problem = snapshot?.problem ?? entry.problem
  return <div className="inspiration-review-sheet" role="dialog" aria-modal="true"><div><header><div><small>{entry.pendingRevision ? (isZh ? '审核新版' : 'Review revision') : (isZh ? '审核用户投稿' : 'Review submission')}</small><h3>{title}</h3></div><button type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><p>{problem}</p><AdminActionFeedback message={feedback} className="inspiration-dialog-feedback" /><label><span>{isZh ? '审核意见' : 'Review note'}</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={isZh ? '要求修改或拒绝时必须填写具体原因' : 'Required when requesting changes or rejecting'} /></label><footer><button type="button" onClick={() => onReview('reject')} disabled={busy}><X size={16}/>{isZh ? '拒绝' : 'Reject'}</button><button type="button" onClick={() => onReview('request_changes')} disabled={busy}>{isZh ? '要求修改' : 'Request changes'}</button><button className="primary" type="button" onClick={() => onReview('approve')} disabled={busy}><Check size={16}/>{isZh ? '通过并发布' : 'Approve & publish'}</button></footer></div></div>
}

function EditorSheet({ isZh, entry, categories, onClose, onSaved }: { isZh: boolean; entry: ApiInspirationEntry; categories: ApiInspirationCategory[]; onClose: () => void; onSaved: (entry: ApiInspirationEntry) => void }) {
  const [form, setForm] = useState(contentForm(entry))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<AdminActionFeedbackMessage | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try { onSaved(await adminService.updateInspiration(entry.id, requestFromForm(form, categories))) }
    catch { setFeedback({ kind: 'error', text: isZh ? '内容没有保存。' : 'Content was not saved.' }) }
    finally { setBusy(false) }
  }
  return <div className="inspiration-review-sheet inspiration-editor-sheet" role="dialog" aria-modal="true"><form onSubmit={(event) => void submit(event)}><header><div><small>{isZh ? '编辑现有内容' : 'EDIT CONTENT'}</small><h3>{entry.title}</h3></div><button type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><AdminActionFeedback message={feedback} className="inspiration-dialog-feedback" /><div className="inspiration-admin-composer inspiration-admin-content-composer"><ContentFormFields isZh={isZh} categories={categories} form={form} setForm={setForm}/></div><footer><button type="button" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</button><button className="primary" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" size={16}/>} {isZh ? '保存为新版本' : 'Save new version'}</button></footer></form></div>
}

function HistorySheet({ isZh, entry, canManage, note, setNote, busy, feedback, onClose, onRollback }: { isZh: boolean; entry: ApiInspirationEntry; canManage: boolean; note: string; setNote: (value: string) => void; busy: boolean; feedback: AdminActionFeedbackMessage | null; onClose: () => void; onRollback: (version: number) => void }) {
  return <div className="inspiration-review-sheet" role="dialog" aria-modal="true"><div><header><div><small>{isZh ? '版本历史' : 'VERSION HISTORY'}</small><h3>{entry.title}</h3></div><button type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>{entry.pendingRevision && <p>{isZh ? '当前有新版正在处理，完成审核或由投稿者撤回后才能回退。' : 'Finish or withdraw the pending revision before rolling back.'}</p>}<AdminActionFeedback message={feedback} className="inspiration-dialog-feedback" />{canManage && !entry.pendingRevision && <label><span>{isZh ? '回退说明（可选）' : 'Rollback note (optional)'}</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>}<div className="inspiration-admin-history">{entry.revisions?.map((revision) => <div key={revision.id}><span><strong>v{revision.version}</strong><small>{revision.status.replaceAll('_', ' ')} · {new Date(revision.createdAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US')}</small></span>{canManage && !entry.pendingRevision && revision.version < entry.version && <button type="button" onClick={() => onRollback(revision.version)} disabled={busy}><RotateCcw size={15}/>{isZh ? '恢复此版本' : 'Restore'}</button>}</div>)}</div></div></div>
}
