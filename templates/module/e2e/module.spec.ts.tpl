import { expect, test } from '@playwright/test'

test('{{displayName}} exposes a usable empty, denied, and mobile-safe surface', async ({ page }) => {
  // TODO(DX-SCAFFOLD): authenticate, navigate through the real product route, and assert recovery states.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('body')).not.toHaveText('MODULE_NOT_IMPLEMENTED')
})
