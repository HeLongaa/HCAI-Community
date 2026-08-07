import { expect, test } from '@playwright/test'
import { selectAdminSection, signInPage } from './helpers'

test('language preference stays quiet and survives reloads', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '中文', exact: true }).click()
  await expect(page.getByRole('heading', { name: '把想法变成工具。' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByTestId('app-toast')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: '把想法变成工具。' })).toBeVisible()
  await expect(page.getByRole('button', { name: '中文', exact: true })).toHaveClass(/is-active/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
})

test('signed-in language preference survives navigation and reloads', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#generations')

  await page.getByRole('button', { name: /Open account menu/ }).click()
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await expect(page.getByRole('button', { name: '资产库', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '资产库', exact: true }).click()
  await expect(page).toHaveURL(/#assets/)
  await page.reload()
  await expect(page.getByRole('button', { name: '资产库', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
})

test('routine workspace controls do not create global toast noise', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#playground?workspace=image')

  const workspacePanels = page.getByRole('navigation', { name: 'Image workspace panels' })
  await workspacePanels.getByRole('button', { name: 'Result' }).click()
  await workspacePanels.getByRole('button', { name: 'Create' }).click()
  await page.locator('.mobile-menu').click()

  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})

test('routine admin section navigation does not create global toast noise', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/#admin')

  for (const section of ['Users', 'Finance', 'Audit log']) {
    await selectAdminSection(page, section)
    await expect(page.getByTestId('app-toast')).toHaveCount(0)
  }
})

test('account menu closes at every interaction boundary', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#home')
  const trigger = page.locator('.topbar-account')
  const menu = page.locator('.account-menu')

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await trigger.click()
  await page.locator('.topbar-context').click()
  await expect(menu).toHaveCount(0)

  await trigger.click()
  await page.getByRole('button', { name: /Dark theme|Light theme/ }).click()
  await expect(menu).toHaveCount(0)

  await trigger.click()
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await expect(menu).toHaveCount(0)

  await trigger.click()
  await page.getByTestId('nav-assets').click()
  await expect(page).toHaveURL(/#assets/)
  await expect(menu).toHaveCount(0)
})

test('pricing stays unavailable without an approved public catalog', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#pricing')

  await expect(page.getByRole('status')).toContainText('Public pricing is not published yet')
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Continue|Buy|Subscribe/ })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/Unlimited|不限量/)
})

test('phase zero product surfaces fit a mobile viewport', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'promptlin')

  for (const route of ['home', 'pricing', 'playground?workspace=image', 'generations', 'assets']) {
    await page.goto(`/#${route}`)
    await expect(page.locator('.app-shell')).toBeVisible()
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  }

  await page.locator('.topbar-account').click()
  const menuBounds = await page.locator('.account-menu').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth }
  })
  expect(menuBounds.left).toBeGreaterThanOrEqual(0)
  expect(menuBounds.right).toBeLessThanOrEqual(menuBounds.viewportWidth)
})

test('unimplemented point redemptions cannot report success', async ({ page }) => {
  await page.goto('/#points')

  await expect(page.locator('.points-redemption-status')).toContainText('Points redemption is not available yet')
  await expect(page.getByRole('button', { name: /Redeem|Unlock|Boost/ })).toHaveCount(0)
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})
