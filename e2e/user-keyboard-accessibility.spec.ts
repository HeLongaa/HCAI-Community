import { expect, test, type Page } from '@playwright/test'

import { signInPage } from './helpers'

const criticalPages = [
  { route: 'home', selector: '.home-workbench' },
  { route: 'playground?workspace=image', selector: '.workspace-page' },
  { route: 'generations', selector: '[data-testid="generation-center"]' },
  { route: 'assets', selector: '[data-testid="asset-library"]' },
  { route: 'tasks', selector: '.task-market-workbench' },
  { route: 'community', selector: '.community-workbench' },
  { route: 'inspiration', selector: '.inspiration-workbench' },
] as const

async function unnamedVisibleControls(page: Page) {
  return page.locator('button, a[href], input, select, textarea').evaluateAll((elements) => elements
    .filter((element) => {
      const control = element as HTMLElement
      const style = window.getComputedStyle(control)
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && control.getBoundingClientRect().width > 0
        && control.getBoundingClientRect().height > 0
        && !(element instanceof HTMLInputElement && element.type === 'hidden')
    })
    .map((element) => {
      const idLabel = element.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`) : null
      const closestLabel = element.closest('label')
      const name = element.getAttribute('aria-label')
        || element.getAttribute('aria-labelledby')
        || element.getAttribute('title')
        || idLabel?.textContent
        || closestLabel?.textContent
        || element.getAttribute('placeholder')
        || element.textContent
        || ''
      return { tag: element.tagName, className: element.className, type: element.getAttribute('type'), name: name.trim() }
    })
    .filter((control) => !control.name))
}

test('Critical user pages expose names for every visible interactive control', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')

  for (const target of criticalPages) {
    await page.goto(`/#${target.route}`)
    await expect(page.locator(target.selector).first()).toBeVisible()
    expect(await unnamedVisibleControls(page), target.route).toEqual([])
  }
})

test('Account and search overlays preserve keyboard focus boundaries', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#home')

  const accountTrigger = page.locator('.topbar-account')
  await accountTrigger.focus()
  await page.keyboard.press('Enter')
  const accountMenu = page.locator('.account-menu')
  await expect(accountMenu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(accountMenu.locator('button').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(accountMenu).toHaveCount(0)
  await expect(accountTrigger).toBeFocused()

  const searchTrigger = page.getByTestId('discovery-search-trigger')
  await searchTrigger.focus()
  await page.keyboard.press('Enter')
  const searchDialog = page.getByRole('dialog', { name: 'Search' })
  await expect(searchDialog).toBeVisible()
  await expect(page.getByTestId('discovery-search-input')).toBeFocused()

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await searchDialog.evaluate((dialog) => dialog.contains(document.activeElement)), `focus escaped search dialog after ${index + 1} tabs`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(searchDialog).toHaveCount(0)
  await expect(searchTrigger).toBeFocused()
})

test('Mobile navigation exposes state and closes back to its trigger', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInPage(page, request, 'promptlin')
  await page.goto('/#home')

  const trigger = page.locator('.mobile-menu')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-expanded/)
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
})
