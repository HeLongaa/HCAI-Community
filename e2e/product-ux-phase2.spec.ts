import { expect, test, type Page } from '@playwright/test'

import { signInPage } from './helpers'

const phaseTwoRoutes = [
  ['tasks', '.task-market-workbench'],
  ['community', '.community-workbench'],
  ['inspiration', '.inspiration-workbench'],
  ['profile', '.profile-shell'],
  ['mine', '.my-tasks-page'],
  ['points', '.points-page'],
  ['pricing', '.pricing-page'],
  ['api', '.developer-access-page'],
] as const

const expectBoundedPage = async (page: Page, selector: string) => {
  await expect(page.locator(selector)).toBeVisible()
  await expect(page.getByText('Page temporarily unavailable')).toHaveCount(0)
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    fakeAccountCopy: /18,420|4,100|Top 4%|前 4%/.test(document.body.innerText),
  }))
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.fakeAccountCopy).toBeFalsy()
}

test('phase 2 product surfaces remain bounded and factual on desktop', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')

  for (const [route, selector] of phaseTwoRoutes) {
    await page.goto(`/#${route}`)
    await expectBoundedPage(page, selector)
  }

  await page.goto('/#community')
  await expect(page.locator('.page-number.active')).toHaveCSS('background-color', 'rgb(237, 90, 66)')

  await page.goto('/#points')
  await expect(page.locator('.points-summary-strip')).toContainText(/\d[\d,]* pts/)
  await expect(page.locator('.points-summary-strip')).not.toContainText('积分')

  await page.goto('/#pricing')
  await expect(page.getByRole('status')).toContainText('Public pricing is not published yet')
  await expect(page.locator('.billing-toggle')).toHaveCount(0)
})

test('phase 2 product surfaces remain bounded at 390px', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')

  for (const [route, selector] of phaseTwoRoutes) {
    await page.goto(`/#${route}`)
    await expectBoundedPage(page, selector)
    if (['profile', 'points', 'api'].includes(route)) {
      await page.screenshot({ path: `test-results/phase2-${route}-mobile.png` })
    }
  }
})

test('phase 2 product surfaces preserve their structure in dark mode', async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem('hcaiThemeMode', 'black'))
  await signInPage(page, request, 'opsplus')

  for (const [route, selector] of phaseTwoRoutes) {
    await page.goto(`/#${route}`)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'black')
    await expectBoundedPage(page, selector)
  }
})
