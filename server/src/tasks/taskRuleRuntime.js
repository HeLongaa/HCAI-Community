import { HttpError } from '../common/errors/httpError.js'

const hoursBetween = (from, to) => (to.getTime() - from.getTime()) / 3_600_000

export const applyPublishedTaskRule = async ({ payload, repository, now = new Date() }) => {
  const rule = await repository.findPublishedTaskRule(payload.category)
  if (!rule) return { ...payload, taskRule: null }
  if (!rule.active) throw new HttpError(422, 'TASK_CATEGORY_UNAVAILABLE', 'Task category is disabled by its published rule')

  let deadlineAt = payload.deadlineAt
  if (!deadlineAt && rule.deadlineRequired) {
    deadlineAt = new Date(now.getTime() + rule.defaultDeadlineHours * 3_600_000).toISOString()
  }
  if (deadlineAt) {
    const parsed = new Date(deadlineAt)
    if (!Number.isFinite(parsed.getTime())) throw new HttpError(422, 'TASK_DEADLINE_INVALID', 'Task deadline must be an ISO 8601 datetime')
    const hours = hoursBetween(now, parsed)
    if (hours < rule.minimumDeadlineHours || hours > rule.maximumDeadlineHours) {
      throw new HttpError(422, 'TASK_DEADLINE_OUT_OF_RANGE', 'Task deadline is outside the published category rule', {
        minimumDeadlineHours: rule.minimumDeadlineHours,
        maximumDeadlineHours: rule.maximumDeadlineHours,
      })
    }
    deadlineAt = parsed.toISOString()
  }

  let acceptanceRules = payload.acceptanceRules
  if (payload.acceptanceTemplateId) {
    const template = rule.acceptanceTemplates.find((item) => item.id === payload.acceptanceTemplateId)
    if (!template) throw new HttpError(422, 'TASK_ACCEPTANCE_TEMPLATE_INVALID', 'Acceptance template is not published for this category')
    acceptanceRules = template.body
  }

  return {
    ...payload,
    deadlineAt,
    acceptanceRules,
    taskRule: { key: rule.key, publishedVersion: rule.publishedVersion, acceptanceTemplateId: payload.acceptanceTemplateId ?? null },
  }
}
