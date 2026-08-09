import { expect, test, type Page } from '@playwright/test'

import type { ApiUserCreativeGeneration, CreativeWorkspace } from '../src/services/contracts'
import { signInPage } from './helpers'

type RetryCase = {
  workspace: CreativeWorkspace
  tab: 'Image' | 'Video' | 'Music'
  mode: string
  generateLabel: string
  creationCopy: string | RegExp
  successCopy: string
  prepare: (page: Page) => Promise<void>
}

const retryCases: RetryCase[] = [
  {
    workspace: 'image',
    tab: 'Image',
    mode: 'text_to_image',
    generateLabel: 'Generate images',
    creationCopy: /Image generation complete|Image job created/,
    successCopy: 'A new image attempt was created with the same inputs.',
    prepare: async () => {},
  },
  {
    workspace: 'video',
    tab: 'Video',
    mode: 'text_to_video',
    generateLabel: 'Generate video',
    creationCopy: 'Video job created.',
    successCopy: 'A new video attempt was created with the same inputs.',
    prepare: async (page) => {
      await page.getByLabel(/rights and consent required/).check()
    },
  },
  {
    workspace: 'music',
    tab: 'Music',
    mode: 'instrumental',
    generateLabel: 'Generate music',
    creationCopy: 'Music job created.',
    successCopy: 'A new music attempt was created with the same inputs.',
    prepare: async (page) => {
      await page.getByLabel(/rights to this prompt/).check()
    },
  },
]

const generationDetail = ({
  id,
  workspace,
  mode,
  status,
  prompt,
  retryOfId = null,
}: {
  id: string
  workspace: CreativeWorkspace
  mode: string
  status: 'failed' | 'completed'
  prompt: string
  retryOfId?: string | null
}): ApiUserCreativeGeneration => ({
  id,
  workspace,
  mode,
  status,
  promptPreview: prompt,
  inputAssetIds: [],
  parameterKeys: [],
  provider: { id: 'mock', mode: 'mock' },
  attempt: { number: retryOfId ? 2 : 1, retryOfId },
  usage: { estimatedCredits: workspace === 'video' ? 8 : workspace === 'music' ? 4 : 1, metered: false },
  safety: { reviewRequired: false },
  error: status === 'failed' ? { code: 'provider_failed', message: 'Fixture generation failed.' } : null,
  outputs: [],
  actions: {
    poll: { available: false, reasonCode: `${status}_is_terminal` },
    cancel: { available: false, reasonCode: `${status}_not_cancellable` },
    retry: {
      available: status === 'failed',
      reasonCode: status === 'failed' ? null : 'completed_not_retryable',
      userConfirmationRequired: true,
      requiresOriginalRequest: true,
    },
    download: { available: false, reasonCode: 'no_clean_output' },
    reuse: { available: false, reasonCode: 'no_clean_output' },
  },
  startedAt: '2026-08-08T10:00:00.000Z',
  completedAt: status === 'completed' ? '2026-08-08T10:01:00.000Z' : null,
  failedAt: status === 'failed' ? '2026-08-08T10:01:00.000Z' : null,
  createdAt: '2026-08-08T10:00:00.000Z',
  updatedAt: '2026-08-08T10:01:00.000Z',
})

for (const retryCase of retryCases) {
  test(`${retryCase.tab} retry uses an in-workspace confirmation and preserves the exact request`, async ({ page, request }) => {
    await signInPage(page, request, 'promptlin')
    const sourceId = `${retryCase.workspace}-retry-source`
    const targetId = `${retryCase.workspace}-retry-target`
    const prompt = `${retryCase.tab} exact retry fixture`
    const source = generationDetail({ id: sourceId, workspace: retryCase.workspace, mode: retryCase.mode, status: 'failed', prompt })
    const target = generationDetail({ id: targetId, workspace: retryCase.workspace, mode: retryCase.mode, status: 'completed', prompt, retryOfId: sourceId })
    let originalRequest: Record<string, unknown> | null = null
    const retryRequests: Record<string, unknown>[] = []
    const nativeDialogs: string[] = []

    page.on('dialog', async (dialog) => {
      nativeDialogs.push(dialog.message())
      await dialog.dismiss()
    })
    await page.route('**/api/creative/generations?*', async (route) => {
      await route.fulfill({ json: { data: [], meta: { pagination: { limit: 20, nextCursor: null } } } })
    })
    await page.route('**/api/creative/input-assets?*', async (route) => {
      await route.fulfill({ json: { data: [], meta: { pagination: { limit: 24, nextCursor: null } } } })
    })
    await page.route(`**/api/creative/generations/${sourceId}`, async (route) => {
      await route.fulfill({ json: { data: source } })
    })
    await page.route(`**/api/creative/generations/${targetId}`, async (route) => {
      await route.fulfill({ json: { data: target } })
    })
    await page.route(`**/api/creative/generations/${sourceId}/retry`, async (route) => {
      retryRequests.push(route.request().postDataJSON())
      if (retryRequests.length === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Retry temporarily unavailable.' } },
        })
        return
      }
      await route.fulfill({
        json: {
          data: {
            duplicate: false,
            mutation: { id: `${sourceId}-retry-mutation` },
            generation: { id: targetId },
          },
        },
      })
    })
    await page.route('**/api/creative/generations', async (route) => {
      originalRequest = route.request().postDataJSON()
      await route.fulfill({
        json: {
          data: {
            id: sourceId,
            workspace: retryCase.workspace,
            mode: retryCase.mode,
            status: 'failed',
            provider: { id: 'mock', mode: 'mock', label: 'Mock Creative Provider' },
            outputs: [],
            usage: { estimatedCredits: source.usage.estimatedCredits, metered: false },
          },
        },
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'AI Workspace' }).click()
    await page.getByRole('button', { name: retryCase.tab, exact: true }).click()
    await retryCase.prepare(page)
    await page.getByRole('button', { name: retryCase.generateLabel }).click()
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    await expect(page.locator('.generation-operation-feedback')).toContainText(retryCase.creationCopy)
    await expect(page.getByTestId('app-toast')).toHaveCount(0)

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    const confirmation = page.getByRole('alertdialog', { name: 'Confirm generation retry' })
    await expect(confirmation).toContainText('exact same inputs')
    await expect(confirmation).toContainText('credits or quota')
    await confirmation.getByRole('button', { name: 'Back' }).click()
    await expect(confirmation).toHaveCount(0)
    expect(retryRequests).toHaveLength(0)

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Retry same inputs' }).click()
    await expect(confirmation).toBeVisible()
    await expect(page.getByText('Retry temporarily unavailable.')).toBeVisible()
    await expect(page.getByTestId('app-toast')).toHaveCount(0)

    await confirmation.getByRole('button', { name: 'Retry same inputs' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByText(retryCase.successCopy)).toBeVisible()
    await expect(page.getByTestId('app-toast')).toHaveCount(0)

    expect(nativeDialogs).toEqual([])
    expect(retryRequests).toHaveLength(2)
    if (!originalRequest) throw new Error('The initial generation request was not captured.')
    const { idempotencyKey: initialCreateKey, ...expectedGeneration } = originalRequest
    expect(initialCreateKey).toMatch(/^generation:[0-9a-f-]{36}$/)
    for (const retryRequest of retryRequests) {
      expect(retryRequest).toMatchObject({
        reasonCode: 'user_confirmed_retry',
        generation: expectedGeneration,
      })
      expect(retryRequest.generation).toEqual(expectedGeneration)
      expect(retryRequest.idempotencyKey).toMatch(/^ui-[0-9a-f-]{36}$/)
    }
    expect(retryRequests[0].idempotencyKey).not.toBe(retryRequests[1].idempotencyKey)
  })
}
