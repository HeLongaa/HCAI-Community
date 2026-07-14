const normalizedStatus = (status) => String(status ?? '').trim().toLowerCase().replaceAll(' ', '_')

export const taskLifecycleActions = ({
  status,
  disputeStatus = null,
  actorHandle,
  publisherHandle,
  assigneeHandle = null,
  hasProposal = false,
  latestSubmissionStatus = null,
  latestSubmitterHandle = null,
  admin = false,
}) => {
  const taskStatus = normalizedStatus(status)
  const submissionStatus = normalizedStatus(latestSubmissionStatus)
  const publisher = admin || Boolean(actorHandle && actorHandle === publisherHandle)
  const assignee = admin || Boolean(actorHandle && actorHandle === assigneeHandle)
  const submitter = admin || Boolean(actorHandle && actorHandle === latestSubmitterHandle)
  const actions = ['view']

  if (taskStatus === 'open' && !publisher && !hasProposal) actions.push('propose')
  if (taskStatus === 'open' && !publisher && !assigneeHandle) actions.push('claim')
  if (taskStatus === 'open' && publisher) actions.push('review_proposals')
  if ((assignee || (taskStatus === 'open' && !publisher && !assigneeHandle)) && ['open', 'in_progress', 'rejected'].includes(taskStatus) && disputeStatus !== 'rejected') actions.push('submit')
  if (publisher && taskStatus === 'pending_review' && submissionStatus === 'pending_review') actions.push('review_submission')
  if (submitter && ['rejected', 'stale'].includes(submissionStatus) && disputeStatus !== 'open') actions.push('open_dispute')
  if (publisher || assignee || hasProposal || submitter) actions.push('view_timeline')

  return [...new Set(actions)]
}

export const taskWorkflowDto = (input) => ({
  taskId: String(input.taskId),
  taskStatus: input.status,
  disputeStatus: input.disputeStatus ?? null,
  latestSubmissionStatus: input.latestSubmissionStatus ?? null,
  role: input.admin
    ? 'admin'
    : input.actorHandle === input.publisherHandle
      ? 'publisher'
      : input.actorHandle === input.assigneeHandle
        ? 'assignee'
        : input.hasProposal
          ? 'proposer'
          : 'viewer',
  actions: taskLifecycleActions(input),
})
