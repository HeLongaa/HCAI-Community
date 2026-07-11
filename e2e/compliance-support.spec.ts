import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('public policy center exposes versioned Terms, AUP, and Provider disclosures', async ({ page }) => {
  await page.goto('/')
  const policiesResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/compliance/policies') && response.request().method() === 'GET',
  )
  await page.getByTestId('policy-center-link').click()
  expect((await policiesResponse).ok()).toBeTruthy()

  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible()
  await expect(page.getByText('Legal review pending')).toBeVisible()
  await expect(page.getByText(/v1-legal-support-/)).toBeVisible()

  await page.getByRole('button', { name: /Acceptable Use Policy/ }).click()
  await expect(page.getByRole('heading', { name: 'Acceptable Use Policy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2. Prohibited harmful content' })).toBeVisible()

  await page.getByRole('button', { name: /AI Provider and Generated Content Disclosure/ }).click()
  await expect(page.getByRole('heading', { name: 'AI Provider and Generated Content Disclosure' })).toBeVisible()
  await expect(page.getByText('openai-gpt-image-2')).toBeVisible()
  await expect(page.getByText('Production not approved').first()).toBeVisible()
})
test('signed-in user can submit and track a content report from support center', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByTestId('support-center-link').click()

  await expect(page.getByRole('heading', { name: 'Support center' })).toBeVisible()
  await page.getByRole('button', { name: /Report content/ }).click()
  await page.getByLabel('Subject').fill('Review a reported community post')
  await page.getByLabel('Details').fill('Please review this post for a possible acceptable-use policy violation.')
  await page.getByLabel('Related resource').selectOption('post')
  await page.getByLabel('Resource ID').fill('post-e2e-policy-42')

  const supportResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/support/requests') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Submit request' }).click()
  const response = await supportResponse
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  const requestId = payload.data.id as string
  const requestArticle = page.getByRole('article').filter({ hasText: requestId })

  await expect(requestArticle).toBeVisible()
  await expect(requestArticle.getByText('Review a reported community post')).toBeVisible()
  await expect(requestArticle.getByText(requestId)).toBeVisible()
  await expect(requestArticle.getByText('Submitted')).toBeVisible()
})
