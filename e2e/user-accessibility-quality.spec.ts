import { expect, test, type Page } from '@playwright/test'

import { selectAdminSection, signInPage } from './helpers'

const userPages = [
  { route: 'home', selector: '.home-workbench', name: 'home' },
  { route: 'community', selector: '.community-workbench', name: 'community' },
  { route: 'playground?workspace=image', selector: '.workspace-page', name: 'workspace' },
  { route: 'assets', selector: '[data-testid="asset-library"]', name: 'assets' },
  { route: 'generations', selector: '[data-testid="generation-center"]', name: 'generations' },
  { route: 'tasks', selector: '.task-market-workbench', name: 'tasks' },
  { route: 'inspiration', selector: '.inspiration-workbench', name: 'inspiration' },
] as const

type ContrastFailure = {
  element: string
  text: string
  ratio: number
  required: number
  foreground: string
  background: string
}

async function textContrastFailures(page: Page, rootSelector: string) {
  return page.locator(rootSelector).first().evaluate((root): ContrastFailure[] => {
    type Color = { r: number; g: number; b: number; a: number }
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = 1
    colorCanvas.height = 1
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })
    const parseColor = (value: string): Color | null => {
      if (!colorContext) return null
      colorContext.clearRect(0, 0, 1, 1)
      colorContext.fillStyle = value
      colorContext.fillRect(0, 0, 1, 1)
      const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: alpha / 255 }
    }
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.a + background.a * (1 - foreground.a)
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      }
    }
    const backgroundFor = (element: Element): Color | null => {
      let background: Color = { r: 0, g: 0, b: 0, a: 0 }
      for (let current: Element | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current)
        if (style.backgroundImage !== 'none') return null
        const layer = parseColor(style.backgroundColor)
        if (layer) background = composite(background, layer)
        if (background.a >= .999) break
      }
      return background.a >= .999 ? background : composite(background, { r: 255, g: 255, b: 255, a: 1 })
    }
    const channel = (value: number) => {
      const normalized = value / 255
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
    }
    const luminance = (color: Color) => .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b)
    const ratio = (first: Color, second: Color) => {
      const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
      return (lighter + .05) / (darker + .05)
    }
    const identifier = (element: Element) => {
      const id = element.id ? `#${element.id}` : ''
      const classes = typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : ''
      return `${element.tagName.toLowerCase()}${id}${classes}`
    }

    return [...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
      const directText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!directText) return []
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .95 || rect.width < 1 || rect.height < 1) return []
      const foreground = parseColor(style.color)
      const background = backgroundFor(element)
      if (!foreground || !background || foreground.a < .95) return []
      const fontSize = Number.parseFloat(style.fontSize)
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400
      const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5
      const actual = ratio(foreground, background)
      if (actual + .01 >= required) return []
      return [{
        element: identifier(element),
        text: directText.slice(0, 80),
        ratio: Number(actual.toFixed(2)),
        required,
        foreground: style.color,
        background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
      }]
    })
  })
}

async function assertSemanticStructure(page: Page, surfaceSelector: string, name: string) {
  const structure = await page.evaluate((selector) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const surface = document.querySelector(selector)
    return {
      mains: [...document.querySelectorAll('main')].filter(visible).length,
      h1: surface ? [...surface.querySelectorAll('h1')].filter(visible).map((item) => item.textContent?.trim() ?? '') : [],
      unnamedImages: surface ? [...surface.querySelectorAll('img')].filter(visible).filter((image) => !image.hasAttribute('alt')).length : 0,
    }
  }, surfaceSelector)
  expect(structure.mains, `${name} visible main landmarks`).toBe(1)
  expect(structure.h1, `${name} visible h1`).toHaveLength(1)
  expect(structure.h1[0], `${name} h1 text`).not.toBe('')
  expect(structure.unnamedImages, `${name} images without alt`).toBe(0)

  const session = await page.context().newCDPSession(page)
  const tree = await session.send('Accessibility.getFullAXTree') as {
    nodes: Array<{ role?: { value?: string }; name?: { value?: string }; ignored?: boolean }>
  }
  const roles = tree.nodes.filter((node) => !node.ignored).map((node) => ({ role: node.role?.value, name: node.name?.value?.trim() ?? '' }))
  expect(roles.some((node) => node.role === 'main'), `${name} Chromium AX main`).toBe(true)
  expect(roles.some((node) => node.role === 'heading' && node.name === structure.h1[0]), `${name} Chromium AX h1`).toBe(true)
  await session.detach()
}

test('Critical user pages meet semantic and WCAG AA text contrast baselines', async ({ page, request }) => {
  test.setTimeout(120_000)
  await signInPage(page, request, 'promptlin')

  for (const theme of ['black', 'white'] as const) {
    await page.goto('/#home')
    await page.evaluate((value) => localStorage.setItem('hcaiThemeMode', value), theme)
    await page.reload()
    for (const target of userPages) {
      await page.goto(`/#${target.route}`)
      await expect(page.locator(target.selector).first()).toBeVisible()
      await assertSemanticStructure(page, target.selector, `${theme}/${target.name}`)
      expect(await textContrastFailures(page, target.selector), `${theme}/${target.name} contrast`).toEqual([])
    }
  }
})

test('Forced Colors preserves critical user and release-control operation boundaries', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await signInPage(page, request, 'promptlin')

  for (const target of userPages) {
    await page.goto(`/#${target.route}`)
    const surface = page.locator(target.selector).first()
    await expect(surface).toBeVisible()
    const result = await surface.evaluate((element) => {
      const controls = [...element.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter((control) => {
        const style = getComputedStyle(control)
        const rect = control.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        unnamed: controls.filter((control) => !(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || control.getAttribute('placeholder') || control.closest('label')?.textContent?.trim())).length,
        suppressed: [...element.querySelectorAll<HTMLElement>('*')].filter((node) => getComputedStyle(node).forcedColorAdjust === 'none' && !['IMG', 'VIDEO', 'CANVAS'].includes(node.tagName)).length,
      }
    })
    expect(result.overflow, `${target.name} forced-colors overflow`).toBeLessThanOrEqual(1)
    expect(result.unnamed, `${target.name} forced-colors unnamed controls`).toBe(0)
    expect(result.suppressed, `${target.name} forced-color-adjust none`).toBe(0)
    const focusTarget = surface.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])').first()
    await focusTarget.focus()
    const focusStyle = await focusTarget.evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth), boxShadow: style.boxShadow }
    })
    expect(focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth >= 1 || focusStyle.boxShadow !== 'none', `${target.name} forced-colors focus`).toBe(true)
  }

  await signInPage(page, request, 'opsplus')
  await page.reload()
  await page.goto('/#admin')
  await selectAdminSection(page, 'Release')
  const releaseControl = page.getByTestId('admin-release-control')
  await expect(releaseControl).toBeVisible()
  await expect(releaseControl.getByRole('heading', { name: 'Release change control' })).toBeVisible()
  expect(await releaseControl.evaluate((element) => element.scrollWidth - element.clientWidth), 'release control forced-colors overflow').toBeLessThanOrEqual(1)
  await page.screenshot({ path: '/tmp/hcai-forced-colors-release-control.png', fullPage: false })
})
