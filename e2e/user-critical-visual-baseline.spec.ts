import { expect, test, type Page } from '@playwright/test'

import { signInPage } from './helpers'

test.use({ reducedMotion: 'reduce' })

const pages = [
  { route: 'home', selector: '.home-workbench', slug: 'home' },
  { route: 'playground?workspace=image', selector: '.workspace-page', slug: 'workspace' },
  { route: 'generations', selector: '[data-testid="generation-center"]', slug: 'generations' },
  { route: 'assets', selector: '[data-testid="asset-library"]', slug: 'assets' },
  { route: 'tasks', selector: '.task-market-workbench', slug: 'tasks' },
  { route: 'community', selector: '.community-workbench', slug: 'community' },
  { route: 'inspiration', selector: '.inspiration-workbench', slug: 'inspiration' },
] as const

async function assertPageSettled(page: Page, selector: string, slug: string) {
  const surface = page.locator(selector).first()
  await expect.poll(
    () => surface.locator(':scope > *').evaluateAll((elements) => elements
      .map((element) => {
        const style = window.getComputedStyle(element)
        return {
          className: element.className,
          hasActiveEntrance: element.getAnimations().some((animation) => {
            const cssAnimation = animation as CSSAnimation
            return cssAnimation.animationName === 'primary-page-enter'
              && (animation.playState === 'running' || animation.playState === 'pending')
          }),
          opacity: Number(style.opacity),
        }
      })
      .filter((item) => item.hasActiveEntrance || item.opacity < 0.99)),
    { message: `${slug} was captured before its route transition settled`, timeout: 2_000 },
  ).toEqual([])
}

async function assertViewportBounded(page: Page, slug: string) {
  const geometry = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('main *')]
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { tag: element.tagName, className: element.className, right: Math.round(rect.right), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
        })
        .filter((item) => item.right > clientWidth + 1 || item.scrollWidth > item.clientWidth + 2)
        .sort((a, b) => Math.max(b.right - clientWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - clientWidth, a.scrollWidth - a.clientWidth))
        .slice(0, 10),
    }
  })
  expect(geometry.scrollWidth, `${slug}: ${JSON.stringify(geometry.offenders)}`).toBeLessThanOrEqual(geometry.clientWidth + 1)
}

test('User critical pages remain bounded across themes and target viewports', async ({ page, request }) => {
  test.setTimeout(180_000)
  await signInPage(page, request, 'promptlin')

  for (const theme of ['black', 'white'] as const) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/#home')
      await page.evaluate((mode) => window.localStorage.setItem('hcaiThemeMode', mode), theme)
      await page.reload()

      for (const target of pages) {
        await page.goto(`/#${target.route}`)
        await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
        await expect(page.locator(target.selector).first()).toBeVisible()
        await assertPageSettled(page, target.selector, `${theme}/${viewport.width}/${target.slug}`)
        await assertViewportBounded(page, `${theme}/${viewport.width}/${target.slug}`)
        await page.screenshot({ path: `/tmp/hcai-user-baseline-${theme}-${viewport.width}-${target.slug}.png`, fullPage: false })
      }
    }
  }
})
