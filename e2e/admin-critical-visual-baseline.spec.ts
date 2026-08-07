import { expect, test, type Page } from '@playwright/test'

import { selectAdminSection, signInPage } from './helpers'

const sections = [
  { label: 'Overview', testId: 'admin-operations-overview', slug: 'overview' },
  { label: 'Users', testId: 'user-admin-panel', slug: 'users' },
  { label: 'Finance', testId: 'admin-entitlements-panel', slug: 'finance' },
  { label: 'Task review', testId: 'task-admin-panel', slug: 'task-review' },
  { label: 'Community', testId: 'community-admin-panel', slug: 'community' },
  { label: 'Inspiration', testId: 'admin-inspiration', slug: 'inspiration' },
  { label: 'Trust & Safety', testId: 'trust-safety-workspace', slug: 'trust-safety' },
  { label: 'Security', testId: 'security-workspace-navigation', slug: 'security' },
  { label: 'Generations', testId: 'admin-generation-history', slug: 'generations' },
] as const

async function assertViewportBounded(page: Page) {
  const geometry = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            tag: element.tagName,
            className: element.className,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }
        })
        .filter((item) => item.right > clientWidth + 1 || item.scrollWidth > item.clientWidth + 2)
        .sort((a, b) => Math.max(b.right - clientWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - clientWidth, a.scrollWidth - a.clientWidth))
        .slice(0, 12),
    }
  })
  expect(geometry.scrollWidth, JSON.stringify(geometry.offenders)).toBeLessThanOrEqual(geometry.clientWidth + 1)
}

test('Admin navigation switches exactly between 1240px and 1241px', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')

  for (const [width, compact] of [[1240, true], [1241, false]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#admin')
    if (compact) {
      await expect(page.locator('.admin-tab-select')).toBeVisible()
      await expect(page.getByTestId('admin-section-rail')).toBeHidden()
    } else {
      await expect(page.locator('.admin-tab-select')).toBeHidden()
      await expect(page.getByTestId('admin-section-rail')).toBeVisible()
    }
    await assertViewportBounded(page)
    await page.screenshot({ path: `/tmp/hcai-admin-baseline-black-${width}-shell.png`, fullPage: false })
  }
})

test('Admin mobile section switching keeps the new title below the sticky selector', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')
  await page.evaluate(() => window.scrollTo(0, 900))
  await selectAdminSection(page, 'Users')
  await expect(page.getByTestId('admin-current-section')).toContainText('Manage accounts and data-rights operations.')
  await expect(page.getByTestId('user-admin-panel')).toBeVisible()

  const geometry = await page.evaluate(() => {
    const selector = document.querySelector<HTMLElement>('.admin-tab-select')?.getBoundingClientRect()
    const heading = document.querySelector<HTMLElement>('.admin-current-section-header')?.getBoundingClientRect()
    return {
      selectorBottom: selector?.bottom ?? 0,
      headingTop: heading?.top ?? 0,
      headingBottom: heading?.bottom ?? 0,
      panelTop: document.querySelector<HTMLElement>('.user-admin-panel')?.getBoundingClientRect().top ?? 0,
    }
  })
  expect(geometry.headingTop).toBeGreaterThanOrEqual(geometry.selectorBottom + 8)
  expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.headingBottom + 8)
  await assertViewportBounded(page)
})

test('Admin critical pages keep bounded geometry in both themes and target viewports', async ({ page, request }) => {
  test.setTimeout(180_000)
  await signInPage(page, request, 'opsplus')

  for (const theme of ['black', 'white'] as const) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/#admin')
      await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
      await page.reload()
      await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)

      for (const section of sections) {
        await selectAdminSection(page, section.label)
        const panel = page.getByTestId(section.testId)
        await expect(panel).toBeVisible()
        await assertViewportBounded(page)
        await page.screenshot({
          path: `/tmp/hcai-admin-baseline-${theme}-${viewport.width}-${section.slug}.png`,
          fullPage: false,
        })
      }
    }
  }
})
