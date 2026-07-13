import { useState } from 'react'
import type { Locale, Page, PublishDraft, Task } from '../domain/types'
import { tasks } from '../data/mockData'
import { copy } from '../i18n/copy'
import { localeFirstTask } from '../domain/utils'
import { taskService } from '../services/taskService'
import type { ApiAcceptanceChecklistItem, ApiTaskProposal, ApiTaskSubmission, ApiTaskTimelineItem } from '../services/contracts'
import { useAsyncResource } from './useAsyncResource'

export type TaskChildCollection<T> = {
  items: T[]
  loading: boolean
  error: string | null
}

type TaskWorkflowOptions = {
  locale: Locale
  pushLedger: (description: string, delta: string) => void
  pushToast: (message: string) => void
  setPage: (page: Page) => void
}

type ReviewTaskOptions = {
  acceptanceChecklist?: ApiAcceptanceChecklistItem[]
}

export function useTaskWorkflows({ locale, pushLedger, pushToast, setPage }: TaskWorkflowOptions) {
  const [taskList, setTaskList] = useState<Task[]>(tasks)
  const [selectedTask, setSelectedTask] = useState<Task>(() => localeFirstTask(tasks, copy.en))
  const [proposalStateByTask, setProposalStateByTask] = useState<Record<string, TaskChildCollection<ApiTaskProposal>>>({})
  const [submissionStateByTask, setSubmissionStateByTask] = useState<Record<string, TaskChildCollection<ApiTaskSubmission>>>({})
  const [timelineStateByTask, setTimelineStateByTask] = useState<Record<string, TaskChildCollection<ApiTaskTimelineItem>>>({})

  const taskStatus = useAsyncResource<Task[]>({
    load: () => taskService.list({ limit: 100 }),
    onSuccess: (items) => {
      if (items.length === 0) return
      setTaskList(items)
      setSelectedTask((current) => items.find((item) => item.id === current.id) ?? items[0])
    },
    getErrorMessage: () => (locale === 'zh' ? '任务 API 暂不可用；未显示本地替代数据。' : 'The task API is unavailable; no local substitute is shown.'),
    deps: [locale],
    logLabel: 'task-service',
  })

  const publishTask = async (draft: PublishDraft) => {
    const isZh = locale === 'zh'
    try {
      const newTask = await taskService.create(draft)
      setTaskList((current) => [newTask, ...current])
      setSelectedTask(newTask)
      pushLedger(isZh ? `发布任务：${newTask.title}` : `Published task: ${newTask.title}`, '+20')
      pushToast(isZh ? `已发布任务：${newTask.title}` : `Task published: ${newTask.title}`)
      setPage('tasks')
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '任务发布失败，已保留本地草稿。' : 'Task publishing failed. Local draft kept.')
    }
  }

  const updateTask = (taskId: Task['id'], updated: Task) => {
    setTaskList((current) => current.map((item) => (item.id === taskId ? updated : item)))
    setSelectedTask(updated)
  }

  const incrementTaskProposals = (taskId: Task['id']) => {
    setTaskList((current) =>
      current.map((item) => (item.id === taskId ? { ...item, proposals: item.proposals + 1 } : item)),
    )
    setSelectedTask((current) => (current.id === taskId ? { ...current, proposals: current.proposals + 1 } : current))
  }

  const refreshProposals = async (task: Task) => {
    const key = String(task.id)
    const isZh = locale === 'zh'
    setProposalStateByTask((current) => ({
      ...current,
      [key]: { items: current[key]?.items ?? [], loading: true, error: null },
    }))
    try {
      const items = await taskService.listProposals(task.id, { limit: 20 })
      setProposalStateByTask((current) => ({
        ...current,
        [key]: { items, loading: false, error: null },
      }))
    } catch (error) {
      console.info('[task-service]', error)
      setProposalStateByTask((current) => ({
        ...current,
        [key]: {
          items: current[key]?.items ?? [],
          loading: false,
          error: isZh ? '无法加载该任务的方案列表。' : 'Could not load proposals for this task.',
        },
      }))
    }
  }

  const refreshSubmissions = async (task: Task) => {
    const key = String(task.id)
    const isZh = locale === 'zh'
    setSubmissionStateByTask((current) => ({
      ...current,
      [key]: { items: current[key]?.items ?? [], loading: true, error: null },
    }))
    try {
      const items = await taskService.listSubmissions(task.id, { limit: 20 })
      setSubmissionStateByTask((current) => ({
        ...current,
        [key]: { items, loading: false, error: null },
      }))
    } catch (error) {
      console.info('[task-service]', error)
      setSubmissionStateByTask((current) => ({
        ...current,
        [key]: {
          items: current[key]?.items ?? [],
          loading: false,
          error: isZh ? '无法加载该任务的交付记录。' : 'Could not load submissions for this task.',
        },
      }))
    }
  }

  const refreshTimeline = async (task: Task) => {
    const key = String(task.id)
    const isZh = locale === 'zh'
    setTimelineStateByTask((current) => ({
      ...current,
      [key]: { items: current[key]?.items ?? [], loading: true, error: null },
    }))
    try {
      const items = await taskService.listTimeline(task.id, { limit: 50 })
      setTimelineStateByTask((current) => ({
        ...current,
        [key]: { items, loading: false, error: null },
      }))
    } catch (error) {
      console.info('[task-service]', error)
      setTimelineStateByTask((current) => ({
        ...current,
        [key]: {
          items: current[key]?.items ?? [],
          loading: false,
          error: isZh ? '无法加载该任务的时间线。' : 'Could not load the task timeline.',
        },
      }))
    }
  }

  const submitProposal = async (task: Task) => {
    const isZh = locale === 'zh'
    try {
      const proposal = await taskService.createProposal(task.id, {
        coverLetter: isZh
          ? `我可以按需求拆解并提交首版方案：${task.title}`
          : `I can scope and deliver a first proposal for: ${task.title}`,
        estimate: isZh ? '首版方案 1 天内提交' : 'First proposal within 1 day',
      })
      setProposalStateByTask((current) => {
        const key = String(task.id)
        const previous = current[key]?.items ?? []
        return {
          ...current,
          [key]: { items: [proposal, ...previous.filter((item) => item.id !== proposal.id)], loading: false, error: null },
        }
      })
      incrementTaskProposals(task.id)
      await refreshTimeline(task)
      pushLedger(isZh ? `提交方案草稿：${task.title}` : `Submitted proposal draft: ${task.title}`, '+50')
      pushToast(isZh ? `方案已提交：${task.title}` : `Proposal submitted: ${task.title}`)
      setPage('mine')
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '方案提交失败，已保留本地状态。' : 'Proposal submission failed. Local state kept.')
    }
  }

  const claimTask = submitProposal

  const acceptProposal = async (task: Task, proposalId: string) => {
    const isZh = locale === 'zh'
    try {
      const proposal = await taskService.reviewProposal(task.id, proposalId, {
        decision: 'accept',
        note: isZh ? '方案已采纳，进入沟通与交付。' : 'Proposal accepted. Moving to discussion and delivery.',
      })
      setProposalStateByTask((current) => {
        const key = String(task.id)
        const nextItems = (current[key]?.items ?? []).map((item) =>
          item.id === proposal.id
            ? proposal
            : item.status === 'pending'
              ? { ...item, status: 'rejected' as const, decisionNote: item.decisionNote || 'Auto-rejected after another proposal was accepted.' }
              : item,
        )
        return { ...current, [key]: { items: nextItems, loading: false, error: null } }
      })
      await taskStatus.refresh()
      await refreshTimeline(task)
      pushToast(isZh ? `已采纳方案：${task.title}` : `Proposal accepted: ${task.title}`)
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '采纳方案失败，请确认当前账号有发布方权限。' : 'Accepting proposal failed. Check publisher permissions.')
    }
  }

  const rejectProposal = async (task: Task, proposalId: string) => {
    const isZh = locale === 'zh'
    try {
      const proposal = await taskService.reviewProposal(task.id, proposalId, {
        decision: 'reject',
        note: isZh ? '暂不采纳该方案。' : 'Not selected for this task.',
      })
      setProposalStateByTask((current) => {
        const key = String(task.id)
        const nextItems = (current[key]?.items ?? []).map((item) => (item.id === proposal.id ? proposal : item))
        return { ...current, [key]: { items: nextItems, loading: false, error: null } }
      })
      await refreshTimeline(task)
      pushToast(isZh ? `已拒绝方案：${task.title}` : `Proposal rejected: ${task.title}`)
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '拒绝方案失败，请确认当前账号有发布方权限。' : 'Rejecting proposal failed. Check publisher permissions.')
    }
  }

  const submitTask = async (task: Task, options: { assetIds?: string[]; rightsNote?: string } = {}) => {
    const isZh = locale === 'zh'
    try {
      const updated = await taskService.submit(task.id, isZh ? '已提交交付成果。' : 'Deliverables submitted.', {
        assetIds: options.assetIds ?? [],
        rightsNote: options.rightsNote ?? (isZh ? '确认交付素材可按任务约定使用。' : 'Deliverables can be used under the agreed task scope.'),
      })
      updateTask(task.id, updated)
      await refreshSubmissions(updated)
      await refreshTimeline(updated)
      pushLedger(isZh ? `提交成果：${task.title}` : `Submitted deliverable: ${task.title}`, '+120')
      pushToast(isZh ? `已提交成果：${task.title}` : `Deliverable submitted: ${task.title}`)
      setPage('mine')
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '提交失败，已保留本地状态。' : 'Submission failed. Local state kept.')
    }
  }

  const approveTask = async (task: Task, options: ReviewTaskOptions = {}) => {
    const isZh = locale === 'zh'
    try {
      const updated = await taskService.review(task.id, 'approve', isZh ? '验收通过，积分已发放。' : 'Accepted. Points released.', options.acceptanceChecklist ?? [])
      updateTask(task.id, updated)
      await refreshSubmissions(updated)
      await refreshTimeline(updated)
      pushLedger(isZh ? `验收通过：${task.title}` : `Accepted task: ${task.title}`, `+${task.points.replace(/[^\d]/g, '') || '500'}`)
      pushToast(isZh ? `验收通过：${task.title}` : `Task accepted: ${task.title}`)
      setPage('points')
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '验收失败，已保留本地状态。' : 'Review failed. Local state kept.')
    }
  }

  const rejectTask = async (task: Task, options: ReviewTaskOptions = {}) => {
    const isZh = locale === 'zh'
    try {
      const updated = await taskService.review(task.id, 'reject', isZh ? '请补充更明确的交付链接和版权确认。' : 'Add clearer delivery links and rights confirmation.', options.acceptanceChecklist ?? [])
      updateTask(task.id, updated)
      await refreshSubmissions(updated)
      await refreshTimeline(updated)
      pushToast(isZh ? `已驳回任务：${task.title}` : `Task rejected: ${task.title}`)
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '驳回失败，已保留本地状态。' : 'Reject failed. Local state kept.')
    }
  }

  const requestRevisionTask = async (task: Task, options: ReviewTaskOptions = {}) => {
    const isZh = locale === 'zh'
    try {
      const updated = await taskService.review(task.id, 'request_changes', isZh ? '请按验收标准补充修改后重新提交。' : 'Revise against the acceptance criteria and resubmit.', options.acceptanceChecklist ?? [])
      updateTask(task.id, updated)
      await refreshSubmissions(updated)
      await refreshTimeline(updated)
      pushToast(isZh ? `已要求修改：${task.title}` : `Changes requested: ${task.title}`)
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '要求修改失败，已保留本地状态。' : 'Request changes failed. Local state kept.')
    }
  }

  const openDisputeTask = async (task: Task) => {
    const isZh = locale === 'zh'
    try {
      const updated = await taskService.createDispute(
        task.id,
        isZh
          ? '交付内容符合验收标准，请平台协助复核驳回或逾期未验收的处理。'
          : 'The delivery appears to meet the acceptance criteria. Please review the rejection or overdue review.',
      )
      updateTask(task.id, updated)
      await refreshSubmissions(updated)
      await refreshTimeline(updated)
      pushToast(isZh ? `已发起争议：${task.title}` : `Dispute opened: ${task.title}`)
    } catch (error) {
      console.info('[task-service]', error)
      pushToast(isZh ? '发起争议失败，请确认该交付已被驳回或已验收逾期。' : 'Opening dispute failed. Confirm the submission was rejected or is review-overdue.')
    }
  }

  return {
    taskList,
    selectedTask,
    setSelectedTask,
    taskStatus,
    proposalStateByTask,
    submissionStateByTask,
    timelineStateByTask,
    refreshTasks: taskStatus.refresh,
    publishTask,
    claimTask,
    submitProposal,
    refreshProposals,
    acceptProposal,
    rejectProposal,
    refreshSubmissions,
    refreshTimeline,
    submitTask,
    approveTask,
    rejectTask,
    requestRevisionTask,
    openDisputeTask,
  }
}
