import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('Image Studio consumes the capability contract and sends only allowed parameters', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/')
  await page.getByRole('button', { name: 'AI Workspace' }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Image Studio' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Text to Image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image to Image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Edit' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Image Variation' })).toBeEnabled()
  await expect(page.getByText(/image-capability-v1/)).toBeVisible()

  await page.getByRole('button', { name: 'Image to Image' }).click()
  await expect(page.getByText('Source image')).toBeVisible()
  await expect(page.getByText(/Change strength 70%/)).toBeVisible()
  await page.getByRole('button', { name: 'Text to Image' }).click()

  const generationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/creative/generations') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Generate images' }).click()
  const response = await generationResponse
  expect(response.ok()).toBeTruthy()
  expect(response.request().postDataJSON()).toMatchObject({
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    parameters: {
      aspectRatio: '1:1',
      stylePreset: 'none',
    },
  })
  expect(response.request().postDataJSON().parameters).not.toHaveProperty('controls')
})
