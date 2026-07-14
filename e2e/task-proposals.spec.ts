import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

test('proposal, submission, and review can complete through the browser workflow', async ({ browser, page, request }) => {
  const publisherSession = await login(request, 'launchteam')
  const taskTitle = `E2E full workflow ${Date.now()}`
  const task = await apiData<{ id: string; title: string }>(
    request.post(`${apiBaseUrl}/api/tasks`, {
      headers: authHeaders(publisherSession.accessToken),
      data: {
        title: taskTitle,
        category: 'Video',
        description: 'Browser regression task for proposal, submission, and review workflow.',
        acceptanceRules: 'Submit proposal, delivery note, rights note, and final review package.',
        pointsReward: 300,
        rewardAmount: null,
        rewardCurrency: null,
        deadlineAt: '3 days',
        visibility: 'public',
        attachmentIds: [],
      },
    }),
  )

  const creatorSession = await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('nav-tasks').click()
  await page.getByTestId(`task-card-${task.id}`).click()
  await expect(page.getByRole('heading', { name: task.title })).toBeVisible()

  const proposalResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/tasks/${task.id}/proposals`) && response.request().method() === 'POST',
  )
  await page.getByTestId('submit-proposal-button').click()
  const response = await proposalResponse
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  expect(payload.data).toMatchObject({ taskId: task.id, status: 'pending' })
  const proposalId = payload.data.id as string

  await expect(page.getByText(/Delivery desk/i)).toBeVisible()
  const proposals = await apiData<Array<{ coverLetter: string; proposer: { handle: string } | null; status: string }>>(
    request.get(`${apiBaseUrl}/api/tasks/${task.id}/proposals`, {
      headers: authHeaders(creatorSession.accessToken),
    }),
  )
  expect(proposals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        proposer: expect.objectContaining({ handle: 'promptlin' }),
        status: 'pending',
      }),
    ]),
  )

  const publisherPage = await browser.newPage()
  await signInPage(publisherPage, request, 'launchteam')
  await publisherPage.goto('/')
  await publisherPage.getByTestId('home-action-mine').click()
  await publisherPage.getByTestId(`mine-task-card-publisher-${task.id}`).click()
  await expect(publisherPage.getByTestId(`proposal-accept-${proposalId}`)).toBeVisible()

  const acceptResponse = publisherPage.waitForResponse((accept) =>
    accept.url().includes(`/api/tasks/${task.id}/proposals/${proposalId}/actions`) && accept.request().method() === 'POST',
  )
  await publisherPage.getByTestId(`proposal-accept-${proposalId}`).click()
  expect((await acceptResponse).ok()).toBeTruthy()

  const creatorDeliveryPage = await browser.newPage()
  await signInPage(creatorDeliveryPage, request, 'promptlin')
  await creatorDeliveryPage.goto('/')
  await creatorDeliveryPage.getByTestId('home-action-mine').click()
  await creatorDeliveryPage.getByTestId(`mine-task-card-maker-${task.id}`).click()

  const submissionResponse = creatorDeliveryPage.waitForResponse((submission) =>
    submission.url().includes(`/api/tasks/${task.id}/submissions`) && submission.request().method() === 'POST',
  )
  await creatorDeliveryPage.getByTestId('submit-work-button').click()
  expect((await submissionResponse).ok()).toBeTruthy()

  await publisherPage.goto('/')
  await publisherPage.getByTestId('home-action-mine').click()
  await publisherPage.getByTestId(`mine-task-card-publisher-${task.id}`).click()
  await expect(publisherPage.getByText('Deliverables submitted.').first()).toBeVisible()
  await expect(publisherPage.getByTestId('task-timeline-item-submitted')).toBeVisible()

  const revisionResponse = publisherPage.waitForResponse((review) =>
    review.url().includes(`/api/tasks/${task.id}/review`) && review.request().method() === 'POST',
  )
  await publisherPage.getByTestId('request-changes-button').click()
  expect((await revisionResponse).ok()).toBeTruthy()

  await creatorDeliveryPage.goto('/')
  await creatorDeliveryPage.getByTestId('home-action-mine').click()
  await creatorDeliveryPage.getByTestId(`mine-task-card-maker-${task.id}`).click()
  await expect(creatorDeliveryPage.getByText('Revise against the acceptance criteria and resubmit.').first()).toBeVisible()
  await expect(creatorDeliveryPage.getByTestId('task-timeline-item-revision_requested')).toBeVisible()

  const revisedSubmissionResponse = creatorDeliveryPage.waitForResponse((submission) =>
    submission.url().includes(`/api/tasks/${task.id}/submissions`) && submission.request().method() === 'POST',
  )
  await creatorDeliveryPage.getByTestId('submit-work-button').click()
  expect((await revisedSubmissionResponse).ok()).toBeTruthy()

  await publisherPage.goto('/')
  await publisherPage.getByTestId('home-action-mine').click()
  await publisherPage.getByTestId(`mine-task-card-publisher-${task.id}`).click()
  await expect(publisherPage.getByText('Deliverables submitted.').first()).toBeVisible()

  const reviewResponse = publisherPage.waitForResponse((review) =>
    review.url().includes(`/api/tasks/${task.id}/review`) && review.request().method() === 'POST',
  )
  await publisherPage.getByTestId('acceptance-checklist-item-0').locator('input').check()
  await publisherPage.getByTestId('approve-submission-button').click()
  expect((await reviewResponse).ok()).toBeTruthy()

  const completedTask = await apiData<{ status: string; assignee: string }>(
    request.get(`${apiBaseUrl}/api/tasks/${task.id}`, {
      headers: authHeaders(publisherSession.accessToken),
    }),
  )
  expect(completedTask).toMatchObject({ status: 'Completed', assignee: 'promptlin' })
  const submissions = await apiData<Array<{ assetIds: string[]; status: string }>>(
    request.get(`${apiBaseUrl}/api/tasks/${task.id}/submissions`, {
      headers: authHeaders(publisherSession.accessToken),
    }),
  )
  expect(submissions[0]?.status).toBe('approved')
  expect(submissions[1]?.status).toBe('revision_requested')
  expect(submissions.every((submission) => submission.assetIds.length === 0)).toBeTruthy()

  await publisherPage.close()
  await creatorDeliveryPage.close()
})

test('rejected delivery can open a dispute and recover after Admin resolution', async ({ page, request }) => {
  const publisherSession = await login(request, 'launchteam')
  const creatorSession = await login(request, 'promptlin')
  const adminSession = await login(request, 'legalpixel')
  const task = await apiData<{ id: string; title: string }>(
    request.post(`${apiBaseUrl}/api/tasks`, {
      headers: authHeaders(publisherSession.accessToken),
      data: {
        title: `E2E dispute recovery ${Date.now()}`,
        category: 'Video',
        description: 'Browser regression task for rejection, dispute, and recovery.',
        acceptanceRules: 'Submit one governed delivery and rights note.',
        pointsReward: 320,
        visibility: 'public',
        attachmentIds: [],
      },
    }),
  )
  await apiData(
    request.post(`${apiBaseUrl}/api/tasks/${task.id}/submissions`, {
      headers: authHeaders(creatorSession.accessToken),
      data: { content: 'Disputed governed delivery.', assetIds: [], rightsNote: 'Rights included.' },
    }),
  )
  await apiData(
    request.post(`${apiBaseUrl}/api/tasks/${task.id}/review`, {
      headers: authHeaders(publisherSession.accessToken),
      data: { decision: 'reject', reviewNote: 'Acceptance evidence is incomplete.', acceptanceChecklist: [] },
    }),
  )

  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('home-action-mine').click()
  await page.getByTestId(`mine-task-card-maker-${task.id}`).click()
  await expect(page.getByTestId('open-dispute-button')).toBeEnabled()
  const disputeResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/tasks/${task.id}/disputes`) && response.request().method() === 'POST',
  )
  await page.getByTestId('open-dispute-button').click()
  const dispute = await disputeResponse
  expect(dispute.ok()).toBeTruthy()
  const disputePayload = await dispute.json()
  const reviewId = disputePayload.data.disputeReviewId as string

  await apiData(
    request.post(`${apiBaseUrl}/api/admin/reviews/${reviewId}/actions`, {
      headers: authHeaders(adminSession.accessToken),
      data: { decision: 'approve', note: 'Creator may submit a clarified revision.' },
    }),
  )
  await page.reload()
  await page.getByTestId(`mine-task-card-maker-${task.id}`).click()
  await expect(page.getByText('Creator may submit a clarified revision.').first()).toBeVisible()
  await expect(page.getByTestId('submit-work-button')).toBeEnabled()
})
