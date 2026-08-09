import { expect, test } from '@playwright/test'
import { signInPage } from './helpers'

test('primary navigation pages use one consistent topbar label', async ({ page, request }) => {
  await signInPage(page, request, 'promptlin')
  await page.goto('/#home')
  await expect(page.locator('.sidebar-nav-label').first()).toHaveText('Discover')

  const workbenches = {
    home: '.home-workbench',
    tasks: '.task-market-workbench',
    community: '.community-workbench',
    inspiration: '.inspiration-workbench',
  }

  for (const route of ['home', 'tasks', 'community', 'inspiration'] as const) {
    await page.goto(`/#${route}`)
    const context = page.locator('.topbar-context')
    await expect(context.locator(':scope > span')).toHaveText(route === 'home' ? 'Home' : route[0].toUpperCase() + route.slice(1))
    await expect(context.locator(':scope > small')).toHaveCount(0)
    const motion = await page.locator(`${workbenches[route]} > *`).first().evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        name: style.animationName,
        duration: style.animationDuration,
        easing: style.animationTimingFunction,
      }
    })
    expect(motion).toEqual({
      name: 'primary-page-enter',
      duration: '0.24s',
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    })
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#tasks')
  await expect(page.locator('.task-market-workbench > *').first()).toHaveCSS('animation-name', 'none')
})

test('discover and create routes follow the same selected theme', async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem('hcaiThemeMode', 'white'))
  await signInPage(page, request, 'promptlin')

  for (const route of ['home', 'tasks', 'community', 'inspiration', 'playground', 'generations', 'assets']) {
    await page.goto(route === 'playground' ? '/#playground?workspace=image' : `/#${route}`)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'white')
    await expect(page.locator('.app-shell')).toHaveCSS('background-color', 'rgb(247, 247, 245)')
    if (route === 'playground') {
      await expect(page.locator('.workspace-image-studio > .composer')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    }
    if (route === 'generations') {
      await expect(page.locator('.generation-filter-bar')).toHaveCSS('background-color', 'rgb(240, 240, 237)')
    }
    if (route === 'assets') {
      await expect(page.locator('.asset-library-filters')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    }
  }

  await page.getByRole('button', { name: /Open account menu/ }).click()
  await page.getByRole('button', { name: 'Dark theme' }).click()

  for (const route of ['home', 'tasks', 'community', 'inspiration', 'playground', 'generations', 'assets']) {
    await page.goto(route === 'playground' ? '/#playground?workspace=image' : `/#${route}`)
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'black')
    await expect(page.locator('.app-shell')).toHaveCSS('background-color', 'rgb(11, 12, 12)')
  }
})
