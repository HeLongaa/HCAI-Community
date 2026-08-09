import { expect, test } from '@playwright/test'
import { apiBaseUrl, apiData, authHeaders, login, signInPage } from './helpers'

type InspirationDto = { id: string; title: string; status: string; favorited: boolean }

const inspirationPayload = (title: string) => ({
  title,
  summary: 'A reviewed method for checking a production release before it reaches users.',
  problem: 'Teams need a repeatable release check that catches visible product regressions.',
  audience: 'Product, design, and engineering teams.',
  categoryId: 'inspiration-category-workflows',
  contentType: 'workflows',
  domains: ['automation'],
  difficulty: 'intermediate',
  toolModels: ['Playwright'],
  content: {
    prerequisites: ['A running application'],
    steps: ['Check the primary flow', 'Verify empty and error states', 'Review desktop and mobile layouts'],
    inputs: ['Release candidate'],
    outputs: ['A verified release decision'],
    examples: [],
    mistakes: ['Treating a rendered page as proof that the workflow works'],
  },
  sourceAttribution: 'HCAI editorial team',
  license: 'Original',
  featured: true,
  supportsTaskDraft: true,
  sortOrder: 10,
})

test('admin inspiration controls render for an authorized operator', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')
  await page.getByRole('main').getByRole('button', { name: 'Inspiration', exact: true }).click()

  const panel = page.getByTestId('admin-inspiration')
  await expect(panel).toBeVisible()
  await panel.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await expect(panel.getByRole('heading', { name: 'Inspiration Library' })).toBeVisible()
  await expect(panel.getByText('0 pending')).toBeVisible()
  await expect(panel.getByText('No content in this view')).toBeVisible()

  await panel.getByRole('button', { name: 'New category' }).click()
  await expect(panel.getByRole('button', { name: 'Save category' })).toBeVisible()
  await expect(panel.getByLabel('Kind')).toContainText('difficulty')

  await page.reload()
  await page.getByRole('main').getByRole('button', { name: 'Inspiration', exact: true }).click()
  const refreshedPanel = page.getByTestId('admin-inspiration')
  await refreshedPanel.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const publishButton = refreshedPanel.getByRole('button', { name: 'Publish official' })
  await publishButton.click()
  await expect(refreshedPanel.getByRole('button', { name: 'Publish official content' })).toBeVisible()
  await expect(refreshedPanel.getByLabel('Difficulty')).toContainText('Intermediate')

  await refreshedPanel.screenshot({ path: 'test-results/inspiration-admin-desktop.png' })
})

test('admin inspiration publish failure preserves the draft and retries without a toast', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  let publishAttempts = 0
  await page.route('**/api/admin/inspiration', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    publishAttempts += 1
    if (publishAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { code: 'INSPIRATION_PUBLISH_UNAVAILABLE', message: 'Inspiration publishing is temporarily unavailable.' } } })
      return
    }
    await route.continue()
  })

  await page.goto('/#admin')
  await page.getByRole('main').getByRole('button', { name: 'Inspiration', exact: true }).click()
  const panel = page.getByTestId('admin-inspiration')
  await panel.getByRole('button', { name: 'Publish official' }).click()
  const title = `Operator publishing workflow ${Date.now()}`
  await panel.getByLabel('Title').fill(title)
  await panel.getByLabel('Summary').fill('A durable operator workflow draft.')
  await panel.getByLabel('Problem').fill('Operators need a repeatable process.')
  await panel.getByLabel('Audience').fill('Operations teams.')
  await panel.getByLabel('Steps').fill('Prepare the release\nVerify the result')
  await panel.getByLabel('Outputs').fill('Verified release')

  await panel.getByRole('button', { name: 'Publish official content' }).click()
  await expect(panel.locator('.inspiration-admin-operation-feedback.error')).toContainText('Official content was not published.')
  await expect(panel.getByLabel('Title')).toHaveValue(title)
  await expect(panel.getByRole('button', { name: 'Publish official content' })).toBeVisible()
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  const published = page.waitForResponse((response) => response.url().endsWith('/api/admin/inspiration') && response.request().method() === 'POST')
  await panel.getByRole('button', { name: 'Publish official content' }).click()
  expect((await published).status()).toBe(201)
  await expect(panel.locator('.inspiration-admin-operation-feedback')).toContainText('Official content published.')
  await expect(panel.getByRole('button', { name: 'Publish official content' })).toHaveCount(0)
  expect(publishAttempts).toBe(2)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('admin inspiration review failure stays in the review dialog and retries without a toast', async ({ page, request }) => {
  const author = await login(request, 'promptlin')
  const title = `Review retry workflow ${Date.now()}`
  const draft = await apiData<InspirationDto>(request.post(`${apiBaseUrl}/api/inspiration/submissions`, {
    headers: authHeaders(author.accessToken),
    data: inspirationPayload(title),
  }))
  await apiData(request.post(`${apiBaseUrl}/api/inspiration/submissions/${draft.id}/submit`, { headers: authHeaders(author.accessToken) }))
  await signInPage(page, request, 'opsplus')
  let reviewAttempts = 0
  await page.route(`**/api/admin/inspiration/${draft.id}/review`, async (route) => {
    reviewAttempts += 1
    if (reviewAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { code: 'INSPIRATION_REVIEW_UNAVAILABLE', message: 'Inspiration review is temporarily unavailable.' } } })
      return
    }
    await route.continue()
  })

  await page.goto('/#admin')
  await page.getByRole('main').getByRole('button', { name: 'Inspiration', exact: true }).click()
  const panel = page.getByTestId('admin-inspiration')
  const row = panel.locator('.inspiration-admin-list article').filter({ hasText: title })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Review' }).click()
  const dialog = page.getByRole('dialog')
  const note = 'Add a concrete verification example.'
  await dialog.getByLabel('Review note').fill(note)
  await dialog.getByRole('button', { name: 'Request changes' }).click()
  await expect(dialog.locator('.inspiration-dialog-feedback.error')).toContainText('The review was not saved.')
  await expect(dialog.getByLabel('Review note')).toHaveValue(note)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Request changes' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.locator('.inspiration-admin-operation-feedback')).toContainText('The review decision was saved.')
  expect(reviewAttempts).toBe(2)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('published inspiration can be discovered, favorited, and opened in the workspace', async ({ page, request }) => {
  const runId = Date.now()
  const title = `Release review method ${runId}`
  const admin = await signInPage(page, request, 'opsplus')
  const created = await apiData<InspirationDto>(request.post(`${apiBaseUrl}/api/admin/inspiration`, {
    headers: authHeaders(admin.accessToken),
    data: inspirationPayload(title),
  }))

  await page.goto('/#inspiration')
  await expect(page.getByRole('heading', { name: 'Discover skills and proven methods' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Content categories' }).getByRole('button', { name: 'Methods & Workflows' })).toBeVisible()
  await expect(page.getByLabel('Catalog filters').getByText('Domain', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Catalog filters').locator('select').first()).toContainText('Automation')

  const row = page.locator('.inspiration-row').filter({ hasText: title })
  await expect(row).toBeVisible()
  await page.screenshot({ path: 'test-results/inspiration-catalog-desktop.png', fullPage: true })
  const favoriteResponse = page.waitForResponse((response) => response.url().endsWith(`/api/inspiration/${created.id}/favorite`) && response.request().method() === 'POST')
  await row.getByRole('button', { name: 'Favorite' }).click()
  expect((await favoriteResponse).status()).toBe(200)

  await page.getByRole('button', { name: 'My Favorites' }).click()
  await expect(page.getByRole('heading', { name: 'My Favorites' })).toBeVisible()
  await expect(page.locator('.inspiration-row').filter({ hasText: title })).toBeVisible()
  const favoriteFilters = page.getByLabel('Favorite filters')
  await expect(favoriteFilters.locator('select').nth(2)).toContainText('Last 7 days')
  await favoriteFilters.getByPlaceholder('Search saved resources').fill('no matching saved resource')
  await expect(page.getByText('No saved resources match these filters')).toBeVisible()
  await favoriteFilters.getByPlaceholder('Search saved resources').fill('')
  await expect(page.locator('.inspiration-row').filter({ hasText: title })).toBeVisible()
  await page.screenshot({ path: 'test-results/inspiration-favorites-desktop.png', fullPage: true })

  await page.locator('.inspiration-row').filter({ hasText: title }).locator('.inspiration-row-open').click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Create task draft' }).click()
  await expect(page).toHaveURL(/#publish$/)
  await expect(page.locator('.form-panel label').filter({ hasText: 'Task title' }).locator('input')).toHaveValue(title)
  await expect(page.locator('.form-panel label').filter({ hasText: 'Reward' }).locator('input')).toHaveValue('')
  await expect(page.locator('.form-panel label').filter({ hasText: 'Deadline' }).locator('input')).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Complete required fields' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish task' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Invite unavailable' })).toHaveCount(0)
  await expect(page.getByText('Recommended makers')).toHaveCount(0)
  const taskLayout = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    cardOverflow: [...document.querySelectorAll<HTMLElement>('.match-card')].map((card) => {
      const box = card.getBoundingClientRect()
      return { left: box.left, right: box.right, viewport: window.innerWidth }
    }).filter((box) => box.left < 0 || box.right > box.viewport + 1),
  }))
  expect(taskLayout.documentOverflow).toBeLessThanOrEqual(1)
  expect(taskLayout.cardOverflow).toEqual([])
  await page.screenshot({ path: 'test-results/inspiration-task-draft-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'test-results/inspiration-task-draft-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`/#inspiration/${created.id}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const useResponse = page.waitForResponse((response) => response.url().endsWith(`/api/inspiration/${created.id}/use`) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Use in Workspace' }).click()
  expect((await useResponse).status()).toBe(200)
  await expect(page).toHaveURL(/#playground\?workspace=chat$/)
})

test('inspiration actions and submission editor stay consistent across desktop and mobile', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#inspiration')

  const headerActions = page.locator('.inspiration-header-actions')
  await expect(headerActions.getByRole('button', { name: 'My Favorites' })).toBeVisible()
  await expect(headerActions.getByRole('button', { name: 'Submit Inspiration' })).toBeVisible()
  const actionMetrics = await headerActions.locator('button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect()
    return { height: box.height, radius: getComputedStyle(button).borderRadius }
  }))
  expect(actionMetrics).toHaveLength(2)
  for (const metric of actionMetrics) {
    expect(metric.height).toBeCloseTo(40, 3)
    expect(metric.radius).toBe('6px')
  }
  await expect(headerActions.getByRole('button', { name: 'Submit Inspiration' })).toHaveCSS('background-color', 'rgb(237, 90, 66)')
  await page.screenshot({ path: 'test-results/inspiration-catalog-actions-desktop.png', fullPage: true })

  await page.goto('/#inspiration/submit')

  const form = page.locator('.inspiration-submission-form')
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Content type')).toContainText('Skills')
  await expect(form.getByLabel('Content type')).not.toContainText('Automation')
  await expect(form.getByRole('group', { name: 'Domains' })).toContainText('Automation')
  await expect(form.getByLabel('Difficulty')).toContainText('Intermediate')
  await expect(form.getByRole('heading', { name: 'Basics' })).toBeVisible()
  await expect(form.getByRole('heading', { name: 'Method content' })).toBeVisible()
  await expect(form.getByText('Draft', { exact: true })).toBeVisible()
  const desktopColumns = await form.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(desktopColumns).toBe(2)
  await page.screenshot({ path: 'test-results/inspiration-submit-desktop.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })

  const layout = await page.locator('.inspiration-workbench').evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overflow: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && node.scrollWidth > node.clientWidth + 2)
      .map((node) => `${node.tagName.toLowerCase()}:${node.clientWidth}/${node.scrollWidth}`),
  }))
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentOverflow).toBeLessThanOrEqual(1)
  expect(layout.overflow).toEqual([])
  expect(await form.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  await page.screenshot({ path: 'test-results/inspiration-submit-mobile.png', fullPage: true })
})

test('community post becomes an inspiration draft prefill instead of a fake library save', async ({ page, request }) => {
  const runId = Date.now()
  const title = `Community method ${runId}`
  const session = await signInPage(page, request, 'promptlin')
  const post = await apiData<{ id: string; version: number }>(request.post(`${apiBaseUrl}/api/posts`, {
    headers: authHeaders(session.accessToken),
    data: {
      title,
      body: 'A community discussion that may become a reusable method after editorial review.',
      category: 'Questions',
      tag: 'Method',
      excerpt: 'A candidate method that still needs structure and review.',
      status: 'published',
    },
  }))

  await page.goto('/#community')
  const topic = page.getByTestId(`community-topic-${post.id}`)
  await expect(topic).toBeVisible()
  await topic.locator('.topic-title-button').click()
  const actionBar = page.locator('.post-action-bar')
  await expect(actionBar.getByTitle('Submit to inspiration')).toBeVisible()
  await expect(actionBar.getByText('Save', { exact: true })).toHaveCount(0)
  await actionBar.getByTitle('Submit to inspiration').click()

  await expect(page).toHaveURL(/#inspiration\/submit$/)
  const form = page.locator('.inspiration-submission-form')
  await expect(form.getByLabel('Title')).toHaveValue(title)
  await expect(form.getByLabel('Short summary')).toHaveValue('A candidate method that still needs structure and review.')
  await expect(form.getByLabel('Source')).toHaveValue(`Community post #${post.id}`)
})
