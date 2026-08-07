import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

test('browser reports route views and privacy-safe runtime error fingerprints', async ({ page }) => {
  const reports: Array<Record<string, unknown>> = []
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/api/observability/client-errors')) return
    reports.push(request.postDataJSON() as Record<string, unknown>)
  })

  await page.goto('/')
  await expect.poll(() => reports.some((report) => report.eventType === 'route_view' && report.route === 'landing')).toBe(true)

  await page.evaluate(() => {
    const error = Object.assign(new Error('private prompt content'), { code: 'CLIENT_TEST_FAILURE' })
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
  })

  await expect.poll(() => reports.some((report) => report.eventType === 'window_error')).toBe(true)
  const errorReport = reports.find((report) => report.eventType === 'window_error')
  expect(errorReport?.errorCode).toBe('CLIENT_TEST_FAILURE')
  expect(errorReport?.messageHash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(errorReport)).not.toContain('private prompt content')
})

test('app error boundary replaces a route that fails to load', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.route('**/src/features/workspace/index.ts*', (route) => route.abort('failed'))

  await page.goto('/#chat')

  await expect(page.getByRole('heading', { name: '页面暂时无法显示' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回首页' })).toBeVisible()
})
