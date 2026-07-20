import { expect, test } from '@playwright/test'

test('global feedback is visible and dismissible', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '中文', exact: true }).click()

  const toast = page.getByTestId('app-toast')
  await expect(toast).toContainText('已切换为中文内容。')
  await toast.getByRole('button', { name: 'Dismiss notification' }).click()
  await expect(toast).toHaveCount(0)
})

test('unimplemented point redemptions cannot report success', async ({ page }) => {
  await page.goto('/#points')

  const rewards = page.locator('.library-card')
  await expect(rewards).toHaveCount(3)
  await expect(rewards.getByRole('button')).toHaveCount(3)
  for (const button of await rewards.getByRole('button').all()) {
    await expect(button).toBeDisabled()
    await expect(button).toContainText('Unavailable')
  }
  await expect(page.getByTestId('app-toast')).toHaveCount(0)
})
