import { expect, test } from '@playwright/test'

import { signInPage } from './helpers'

const trackParticleRequests = (page: import('@playwright/test').Page) => {
  const urls: string[] = []
  page.on('request', (request) => {
    if (/ParticleMorphBackground|\/models\/.*\.pcloud\.bin/.test(request.url())) urls.push(request.url())
  })
  return urls
}

test('guest entry uses a branded animated authentication flow', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined })
  })
  await page.goto('/')

  const landing = page.locator('.hcai-landing')
  await expect(landing).toBeVisible()
  const landingGeometry = await page.evaluate(() => {
    const heading = document.querySelector('.hcai-cinema-copy article.is-active h1')?.getBoundingClientRect()
    const login = document.querySelector('.hcai-nav-enter')?.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      heading: heading ? { top: heading.top, bottom: heading.bottom } : null,
      login: login ? { left: login.left, right: login.right } : null,
    }
  })
  expect(landingGeometry.heading).not.toBeNull()
  expect(landingGeometry.heading!.top).toBeGreaterThanOrEqual(0)
  expect(landingGeometry.heading!.bottom).toBeLessThanOrEqual(landingGeometry.viewportHeight)
  expect(landingGeometry.login).not.toBeNull()
  expect(landingGeometry.login!.left).toBeGreaterThanOrEqual(0)
  expect(landingGeometry.login!.right).toBeLessThanOrEqual(landingGeometry.viewportWidth)

  await page.getByRole('button', { name: 'Login' }).click()
  await expect(landing).toHaveClass(/is-leaving/)
  await expect(page).toHaveURL(/#auth$/)

  const authPage = page.locator('.auth-page-shell')
  await expect(authPage).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByText('Using signed local callbacks')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Local admin test login' })).toHaveCount(0)
  await expect(page.locator('details.local-test-account-list')).not.toHaveAttribute('open', '')
  const submitGeometry = await page.locator('.auth-submit').evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight }
  })
  expect(submitGeometry.top).toBeGreaterThanOrEqual(0)
  expect(submitGeometry.bottom).toBeLessThanOrEqual(submitGeometry.viewportHeight)

  for (const provider of ['Google', 'GitHub', 'Apple', 'Discord']) {
    const button = page.getByRole('button', { name: provider })
    await expect(button).toBeVisible()
    await expect(button.locator('svg')).toHaveCount(1)
  }

  await page.getByRole('button', { name: 'Back to home' }).click()
  await expect(authPage).toHaveClass(/is-leaving/)
  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect(page).toHaveURL(/#home$/)
})

test('signing out returns an authenticated user to the public home page', async ({ page, request }) => {
  await signInPage(page, request, 'opsplus')
  await page.goto('/')

  await page.getByRole('button', { name: 'Open account menu for OpsPlus Admin' }).click()
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible()
  await page.getByRole('button', { name: 'Logout' }).click()

  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect(page).toHaveURL(/#home$/)
})

test('reduced motion keeps the public entry usable without mounting WebGL', async ({ page }) => {
  const particleRequests = trackParticleRequests(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Turn ideas into tools.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
  const staticVisual = page.getByTestId('landing-static-visual')
  await expect(staticVisual).toBeVisible()
  await expect(staticVisual).toHaveCSS('background-image', /landing-particles-static\.webp/)
  await expect(page.locator('.hcai-particle-background canvas')).toHaveCount(0)
  await page.waitForTimeout(1_300)
  expect(particleRequests).toEqual([])
  await page.screenshot({ path: '/tmp/hcai-landing-static-visual.png' })
})

test('reduced data keeps the public entry usable without downloading WebGL', async ({ page }) => {
  const particleRequests = trackParticleRequests(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, effectiveType: '4g' },
    })
  })
  await page.goto('/')

  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Turn ideas into tools.' })).toBeVisible()
  await expect(page.getByTestId('landing-static-visual')).toBeVisible()
  await expect(page.locator('.hcai-particle-background canvas')).toHaveCount(0)
  await page.waitForTimeout(1_300)
  expect(particleRequests).toEqual([])
})

test('low capability devices keep the public entry usable without downloading WebGL', async ({ page }) => {
  const particleRequests = trackParticleRequests(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.locator('.hcai-landing')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Login' })).toBeEnabled()
  await expect(page.getByTestId('landing-static-visual')).toBeVisible()
  await expect(page.locator('.hcai-particle-background canvas')).toHaveCount(0)
  await page.waitForTimeout(1_300)
  expect(particleRequests).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/hcai-landing-static-visual-mobile.png' })
})

test('deferred particle scene renders nonblank on desktop and mobile', async ({ page }, testInfo) => {
  const desktopParticleRequests = trackParticleRequests(page)
  await page.goto('/')
  const canvas = page.locator('.hcai-particle-background canvas')
  await expect(canvas).toBeVisible()

  await expect(canvas).toHaveAttribute('data-render-state', 'nonblank')
  const inspectCanvas = () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    return {
      width: target.width,
      height: target.height,
      coloredPixels: Number(target.dataset.coloredPixels ?? 0),
    }
  })
  const desktop = await inspectCanvas()
  expect(desktop.width).toBeGreaterThan(0)
  expect(desktop.height).toBeGreaterThan(0)
  expect(desktop.coloredPixels).toBeGreaterThan(100)
  expect(desktopParticleRequests.some((url) => /\/models\/1111\.pcloud\.bin$/.test(url))).toBe(true)
  expect(desktopParticleRequests.some((url) => /-mobile\.pcloud\.bin$/.test(url))).toBe(false)
  await testInfo.attach('landing-particles-desktop', { body: await page.screenshot(), contentType: 'image/png' })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await inspectCanvas()).width).toBeLessThanOrEqual(585)
  await expect(canvas).toHaveAttribute('data-render-state', 'nonblank')
  expect((await inspectCanvas()).coloredPixels).toBeGreaterThan(100)
  await testInfo.attach('landing-particles-mobile', { body: await page.screenshot(), contentType: 'image/png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const mobilePage = await page.context().newPage()
  const mobileParticleRequests = trackParticleRequests(mobilePage)
  await mobilePage.setViewportSize({ width: 390, height: 844 })
  await mobilePage.goto('/')
  const mobileCanvas = mobilePage.locator('.hcai-particle-background canvas')
  await expect(mobileCanvas).toHaveAttribute('data-render-state', 'nonblank')
  expect(mobileParticleRequests.some((url) => /\/models\/1111-mobile\.pcloud\.bin$/.test(url))).toBe(true)
  expect(mobileParticleRequests.some((url) => /\/models\/1111\.pcloud\.bin$/.test(url))).toBe(false)
  await mobilePage.close()
})

test('particle scene falls back during WebGL context loss and restores a nonblank frame', async ({ page }) => {
  await page.goto('/')
  const background = page.locator('.hcai-particle-background')
  const canvas = background.locator('canvas')
  await expect(canvas).toHaveAttribute('data-render-state', 'nonblank')

  const extensionAvailable = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('webgl2') ?? target.getContext('webgl')
    const extension = context?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    Object.defineProperty(window, '__restoreHcaiWebgl', { configurable: true, value: () => extension.restoreContext() })
    extension.loseContext()
    return true
  })
  expect(extensionAvailable).toBe(true)
  await expect(background).toHaveClass(/is-error/)
  await expect(background).toHaveCSS('background-image', /landing-particles-static/)

  await page.evaluate(() => {
    const restore = (window as typeof window & { __restoreHcaiWebgl?: () => void }).__restoreHcaiWebgl
    restore?.()
  })
  await expect(background).toHaveClass(/is-ready/)
  await expect(canvas).toHaveAttribute('data-render-state', 'nonblank')
})
