import { api, withQuery } from './apiClient'
import type { PublishDraft, Task } from '../domain/types'
import type {
  ApiTask,
  ApiTaskProposal,
  ApiTaskSubmission,
  ApiTaskTimelineItem,
  ApiTaskWorkflow,
  ApiTaskDeliveryTarget,
  ApiAcceptanceChecklistItem,
  CreateTaskDisputeRequest,
  CreateTaskProposalRequest,
  CreateTaskRequest,
  ReviewTaskProposalRequest,
  ReviewTaskRequest,
  SubmitTaskRequest,
  SweepStaleTaskSubmissionsRequest,
  SweepStaleTaskSubmissionsResponse,
  TaskChildListQuery,
  TaskListQuery,
} from './contracts'

const budgetText = (budget: ApiTask['budget']) => {
  if (typeof budget === 'string') return budget
  const money = budget.money?.toString().trim()
  const points = budget.points == null ? '' : `${budget.points} pts`
  return [money, points].filter(Boolean).join(' / ') || '0 pts'
}

const pointsText = (budget: ApiTask['budget']) => {
  if (typeof budget === 'string') {
    return budget.includes('pts') ? budget : `${budget}`
  }
  return budget.points == null ? budgetText(budget) : `${budget.points} pts`
}

const toTask = (task: ApiTask): Task => ({
  id: task.id,
  title: task.title,
  category: task.category,
  budget: budgetText(task.budget),
  points: pointsText(task.budget),
  status: task.status,
  deadline: task.deadline,
  proposals: task.proposals,
  description: task.description,
  publisher: task.publisher,
  assignee: task.assignee,
  requirements: task.requirements ?? [],
  attachments: task.attachments ?? [],
  privateBrief: task.privateBrief ?? '',
  submission: task.submission ?? '',
  resultLinks: task.resultLinks ?? [],
  reviewNote: task.reviewNote ?? '',
  rights: task.rights ?? '',
})

export const taskService = {
  workflow(id: string | number) {
    return api.get<ApiTaskWorkflow>(`/tasks/${id}/workflow`)
  },
  deliveryTargets() {
    return api.get<ApiTaskDeliveryTarget[]>('/tasks/delivery-targets')
  },
  async list(query?: TaskListQuery) {
    const response = await api.get<ApiTask[]>(withQuery('/tasks', query))
    return response.map(toTask)
  },
  async create(draft: PublishDraft) {
    const body: CreateTaskRequest = {
      title: draft.title,
      category: draft.category,
      description: draft.details,
      acceptanceRules: draft.rules,
      pointsReward: Number.parseInt(draft.reward.replace(/[^\d]/g, ''), 10) || 0,
      rewardAmount: null,
      rewardCurrency: null,
      deadlineAt: draft.deadline,
      visibility: draft.visibility,
      attachmentIds: draft.attachmentIds ?? [],
    }
    const task = await api.post<ApiTask>('/tasks', body)
    return toTask(task)
  },
  async claim(id: string | number) {
    const task = await api.post<ApiTask>(`/tasks/${id}/claim`)
    return toTask(task)
  },
  async createProposal(id: string | number, body: CreateTaskProposalRequest) {
    return api.post<ApiTaskProposal>(`/tasks/${id}/proposals`, body)
  },
  async listProposals(id: string | number, query?: TaskChildListQuery) {
    return api.get<ApiTaskProposal[]>(withQuery(`/tasks/${id}/proposals`, query))
  },
  async reviewProposal(id: string | number, proposalId: string, body: ReviewTaskProposalRequest) {
    return api.post<ApiTaskProposal>(`/tasks/${id}/proposals/${proposalId}/actions`, body)
  },
  async submit(id: string | number, content: string, options: Pick<SubmitTaskRequest, 'assetIds' | 'rightsNote'> = { assetIds: [], rightsNote: '' }) {
    const body: SubmitTaskRequest = {
      content,
      assetIds: options.assetIds,
      rightsNote: options.rightsNote,
    }
    const task = await api.post<ApiTask>(`/tasks/${id}/submissions`, body)
    return toTask(task)
  },
  async listSubmissions(id: string | number, query?: TaskChildListQuery) {
    return api.get<ApiTaskSubmission[]>(withQuery(`/tasks/${id}/submissions`, query))
  },
  async listTimeline(id: string | number, query?: TaskChildListQuery) {
    return api.get<ApiTaskTimelineItem[]>(withQuery(`/tasks/${id}/timeline`, query))
  },
  async review(id: string | number, decision: 'approve' | 'reject' | 'request_changes', reviewNote: string, acceptanceChecklist: ApiAcceptanceChecklistItem[] = []) {
    const body: ReviewTaskRequest = { decision, reviewNote, acceptanceChecklist }
    const task = await api.post<ApiTask>(`/tasks/${id}/review`, body)
    return toTask(task)
  },
  async createDispute(id: string | number, reason: string) {
    const body: CreateTaskDisputeRequest = { reason }
    const task = await api.post<ApiTask>(`/tasks/${id}/disputes`, body)
    return toTask(task)
  },
  async sweepStaleSubmissions(body: SweepStaleTaskSubmissionsRequest = {}) {
    return api.post<SweepStaleTaskSubmissionsResponse>('/tasks/stale-submissions/sweep', body)
  },
}
