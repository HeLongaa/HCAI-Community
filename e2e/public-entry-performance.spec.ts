import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const budgets = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/public-entry-performance-budgets.json'), 'utf8'))

type PerformanceSnapshot = {
  origin: string
  domContentLoadedMs: number
  loadEventMs: number
  lcpMs: number
  maximumLongTaskMs: number
  totalLongTaskMs: number
  transferBytes: number
  resourceUrls: string[]
}

const installPerformanceObservers = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    const state = { lcp: 0, longTasks: [] as number[] }
    Object.defineProperty(window, '__hcaiPerformance', { configurable: false, value: state })
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = Math.max(state.lcp, entry.startTime)
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch { /* Unsupported observers are reported by a zero metric and fail the gate. */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
      }).observe({ type: 'longtask', buffered: true })
    } catch { /* Unsupported observers are reported by a zero metric and fail the gate. */ }
  })
}

const routeApiAsSignedOut = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }),
  }))
}

const snapshot = (page: import('@playwright/test').Page) => page.evaluate<PerformanceSnapshot>(() => {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const state = (window as typeof window & { __hcaiPerformance?: { lcp: number; longTasks: number[] } }).__hcaiPerformance
  const longTasks = state?.longTasks ?? []
  return {
    origin: location.origin,
    domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? Number.POSITIVE_INFINITY,
    loadEventMs: navigation?.loadEventEnd ?? Number.POSITIVE_INFINITY,
    lcpMs: state?.lcp ?? 0,
    maximumLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
    totalLongTaskMs: longTasks.reduce((total, duration) => total + duration, 0),
    transferBytes: resources.reduce((total, resource) => total + Math.max(0, resource.transferSize), 0),
    resourceUrls: resources.map((resource) => resource.name),
  }
})

const assertBudget = (metrics: PerformanceSnapshot, budget: Record<string, number>) => {
  expect(metrics.domContentLoadedMs).toBeGreaterThan(0)
  expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(budget.maximumDomContentLoadedMs)
  expect(metrics.loadEventMs).toBeGreaterThan(0)
  expect(metrics.loadEventMs).toBeLessThanOrEqual(budget.maximumLoadEventMs)
  expect(metrics.lcpMs).toBeGreaterThan(0)
  expect(metrics.lcpMs).toBeLessThanOrEqual(budget.maximumLcpMs)
  expect(metrics.maximumLongTaskMs).toBeLessThanOrEqual(budget.maximumLongTaskMs)
  expect(metrics.totalLongTaskMs).toBeLessThanOrEqual(budget.maximumTotalLongTaskMs)
  expect(metrics.transferBytes).toBeLessThanOrEqual(budget.maximumTransferBytes)
  expect(metrics.resourceUrls.every((url) => new URL(url).origin === metrics.origin)).toBe(true)
}

test('full particle entry meets production navigation, LCP, long-task, interaction, and transfer budgets', async ({ page }, testInfo) => {
  await installPerformanceObservers(page)
  await routeApiAsSignedOut(page)
  await page.goto('/', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Turn ideas into tools.' })).toBeVisible()
  await expect(page.locator('.hcai-particle-background canvas')).toHaveAttribute('data-render-state', 'nonblank')
  await page.waitForTimeout(1_000)

  const nextPaintInteractionMs = await page.getByRole('button', { name: '中文' }).evaluate((button) => new Promise<number>((resolve) => {
    const startedAt = performance.now()
    button.click()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - startedAt)))
  }))
  const metrics = await snapshot(page)
  assertBudget(metrics, budgets.fullVisual)
  expect(nextPaintInteractionMs).toBeLessThanOrEqual(budgets.fullVisual.maximumNextPaintInteractionMs)
  expect(metrics.resourceUrls.filter((url) => /\.pcloud-[\w-]+\.bin/.test(url))).toHaveLength(3)
  fs.writeFileSync('/tmp/hcai-public-entry-performance-full.json', `${JSON.stringify({ ...metrics, nextPaintInteractionMs }, null, 2)}\n`)
  await testInfo.attach('full-visual-performance.json', {
    body: Buffer.from(JSON.stringify({ ...metrics, nextPaintInteractionMs }, null, 2)),
    contentType: 'application/json',
  })
})

test('static fallback meets production budgets without Three.js or point-cloud transfer', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 })
  })
  await installPerformanceObservers(page)
  await routeApiAsSignedOut(page)
  await page.goto('/', { waitUntil: 'load' })
  await expect(page.getByTestId('landing-static-visual')).toBeVisible()
  await expect(page.locator('.hcai-particle-background canvas')).toHaveCount(0)
  await page.waitForTimeout(1_300)

  const metrics = await snapshot(page)
  assertBudget(metrics, budgets.staticVisual)
  expect(metrics.resourceUrls.some((url) => /ParticleMorphBackground|\.pcloud-[\w-]+\.bin/.test(url))).toBe(false)
  expect(metrics.resourceUrls.some((url) => /landing-particles-static-[\w-]+\.webp/.test(url))).toBe(true)
  fs.writeFileSync('/tmp/hcai-public-entry-performance-static.json', `${JSON.stringify(metrics, null, 2)}\n`)
  await testInfo.attach('static-visual-performance.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  })
})
