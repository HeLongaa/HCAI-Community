import { expect, test, type Page } from '@playwright/test'

import { signInPage } from './helpers'

const userPages = [
  { route: 'home', selector: '.home-workbench', name: 'home' },
  { route: 'tasks', selector: '.task-market-workbench', name: 'tasks' },
  { route: 'community', selector: '.community-workbench', name: 'community' },
  { route: 'inspiration', selector: '.inspiration-workbench', name: 'inspiration' },
  { route: 'playground?workspace=image', selector: '.workspace-page', name: 'workspace' },
  { route: 'generations', selector: '[data-testid="generation-center"]', name: 'generations' },
  { route: 'assets', selector: '[data-testid="asset-library"]', name: 'assets' },
] as const

type LayoutAudit = {
  documentOverflow: number
  elementOverflow: string[]
  clippedControls: string[]
  undersizedControls: string[]
}

async function auditLayout(page: Page, rootSelector: string): Promise<LayoutAudit> {
  return page.locator(rootSelector).first().evaluate((root) => {
    const identifier = (element: Element) => {
      const id = element.id ? `#${element.id}` : ''
      const classes = typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : ''
      return `${element.tagName.toLowerCase()}${id}${classes}`
    }
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0
    }
    const hasHorizontalScroller = (element: HTMLElement) => {
      for (let current = element.parentElement; current && current !== root; current = current.parentElement) {
        const overflow = getComputedStyle(current).overflowX
        if ((overflow === 'auto' || overflow === 'scroll') && current.scrollWidth > current.clientWidth + 1) return true
      }
      return false
    }
    const elements = [root, ...root.querySelectorAll<HTMLElement>('*')].filter((element): element is HTMLElement => element instanceof HTMLElement && visible(element))
    const controls = elements.filter((element) => element.matches('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"]'))
    const elementOverflow = elements.flatMap((element) => {
      const style = getComputedStyle(element)
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return []
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) return []
      if (element.scrollWidth <= element.clientWidth + 2) return []
      return [`${identifier(element)} ${element.clientWidth}/${element.scrollWidth}`]
    }).slice(0, 20)
    const clippedControls = controls.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const outsideViewport = rect.left < -1 || rect.right > document.documentElement.clientWidth + 1
      const contentClipped = element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2
      if ((!outsideViewport || hasHorizontalScroller(element)) && !contentClipped) return []
      return [`${identifier(element)} rect=${Math.round(rect.left)}..${Math.round(rect.right)} size=${element.clientWidth}x${element.clientHeight} scroll=${element.scrollWidth}x${element.scrollHeight}`]
    }).slice(0, 20)
    const undersizedControls = controls.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.right <= 0 || rect.left >= document.documentElement.clientWidth) return []
      if (rect.width + .5 >= 24 && rect.height + .5 >= 24) return []
      return [`${identifier(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}`]
    }).slice(0, 20)
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      elementOverflow,
      clippedControls,
      undersizedControls,
    }
  })
}

async function expectLayoutPasses(page: Page, selector: string, name: string) {
  const audit = await auditLayout(page, selector)
  const failures = {
    ...(audit.documentOverflow > 1 ? { documentOverflow: audit.documentOverflow } : {}),
    ...(audit.elementOverflow.length > 0 ? { elementOverflow: audit.elementOverflow } : {}),
    ...(audit.clippedControls.length > 0 ? { clippedControls: audit.clippedControls } : {}),
    ...(audit.undersizedControls.length > 0 ? { undersizedControls: audit.undersizedControls } : {}),
  }
  expect(failures, `${name} layout audit`).toEqual({})
}

async function applyWcagTextSpacing(page: Page) {
  await page.addStyleTag({
    content: `
      body * {
        line-height: 1.5 !important;
        letter-spacing: .12em !important;
        word-spacing: .16em !important;
      }
      body p {
        margin-bottom: 2em !important;
      }
    `,
  })
}

test('Auth and critical user pages reflow without loss at 320 CSS pixels', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await page.goto('/#auth')
  await expect(page.locator('.auth-page-panel')).toBeVisible()
  await expectLayoutPasses(page, '.auth-page-shell', 'auth/320')
  await page.screenshot({ path: '/tmp/hcai-auth-reflow-320.png', fullPage: false })

  await signInPage(page, request, 'promptlin')
  await page.reload()
  for (const theme of ['black', 'white'] as const) {
    await page.goto('/#home')
    await page.evaluate((value) => localStorage.setItem('hcaiThemeMode', value), theme)
    await page.reload()
    for (const target of userPages) {
      await page.goto(`/#${target.route}`)
      await expect(page.locator(target.selector).first()).toBeVisible()
      await expectLayoutPasses(page, target.selector, `${theme}/${target.name}/320`)
      await page.screenshot({ path: `/tmp/hcai-reflow-${theme}-320-${target.name}.png`, fullPage: false })
    }
  }
})

test('Auth and critical user pages tolerate WCAG text spacing overrides', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await page.goto('/#auth')
  await expect(page.locator('.auth-page-panel')).toBeVisible()
  await applyWcagTextSpacing(page)
  await expectLayoutPasses(page, '.auth-page-shell', 'auth/text-spacing')

  await signInPage(page, request, 'promptlin')
  await page.reload()
  for (const target of userPages) {
    await page.goto(`/#${target.route}`)
    await expect(page.locator(target.selector).first()).toBeVisible()
    await applyWcagTextSpacing(page)
    await expectLayoutPasses(page, target.selector, `${target.name}/text-spacing`)
    await page.screenshot({ path: `/tmp/hcai-text-spacing-${target.name}.png`, fullPage: false })
  }
})
