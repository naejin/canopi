// An open Design shows in the frame its first scene is drawn (app/canvas-map-surface/design-reveal.ts), so its chrome never
// sits over an empty map; until then the chrome is laid out but transparent. One opened from the start screen keeps the start
// screen up meanwhile; one already open when the canvas mounts (a reload restoring a Draft) never shows it. The unit tests
// drive the signal through a stub renderer; these scenarios sample every animation frame of the real page while a Design
// opens, cold, after Close Design, over another open Design and on a reload, and check that an open from the start screen
// shows no frame with neither the start screen nor the drawn scene, and that a switch or a reload never shows the start
// screen. A real browser also checks what jsdom cannot: a field that focuses itself while hidden keeps its focus. The map is
// aria-busy until its renderer has drawn the latest scene (support/canvas.ts).
// No baselines: nothing here is compared with a recorded screenshot.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { designMap, expectCanvasDrawn } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

interface FrameSample {
  readonly startScreen: boolean
  readonly chromeShown: boolean
  readonly sceneDrawn: boolean
}

/** Records, in every animation frame from now on, whether the start screen, the tool rail and the drawn scene are shown. */
function sampleEveryFrame(): void {
  const page = window as unknown as { __revealSamples?: FrameSample[] }
  const sampling = page.__revealSamples !== undefined
  page.__revealSamples = []
  if (sampling) return
  const sample = () => {
    const rail = document.querySelector('[data-tool-rail]')
    const map = document.querySelector('[role="application"]')
    page.__revealSamples!.push({
      startScreen: document.querySelector('[data-start-screen]') !== null,
      chromeShown: rail !== null && rail.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      sceneDrawn: map !== null && map.getAttribute('aria-busy') !== 'true',
    })
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(sampleEveryFrame)
}

/** The frames sampled since startSampling, once a frame has sampled the shown Design. */
async function samples(page: Page): Promise<FrameSample[]> {
  const read = () => page.evaluate(() => (window as unknown as { __revealSamples: FrameSample[] }).__revealSamples.slice())
  await expect.poll(async () => (await read()).some((frame) => frame.chromeShown), 'a frame sampled the shown Design').toBe(true)
  return read()
}

async function openFixture(page: Page, choose = () => page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click()): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), choose()])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expectCanvasDrawn(page)
}

function expectNoBlankFrame(frames: readonly FrameSample[]): void {
  const blank = frames.findIndex((frame) => !frame.startScreen && !frame.sceneDrawn)
  expect(blank, `frame ${blank} shows the map before its scene is drawn: ${JSON.stringify(frames.slice(Math.max(0, blank - 2), blank + 3))}`).toBe(-1)
  const chromeOverEmptyMap = frames.findIndex((frame) => frame.chromeShown && !frame.sceneDrawn)
  expect(chromeOverEmptyMap, 'the chrome never shows before the scene is drawn').toBe(-1)
}

test('opening a Design shows its chrome with its drawn scene, cold and after Close Design', async ({ page }) => {
  await page.goto('')
  await expect(page.locator('[data-start-screen]')).toBeVisible()

  await startSampling(page)
  await openFixture(page)
  expectNoBlankFrame(await samples(page))

  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Close Design' }).click()
  await expect(page.locator('[data-start-screen]')).toBeVisible()

  await startSampling(page)
  await openFixture(page)
  expectNoBlankFrame(await samples(page))
})

test('opening another Design over an open one never brings the start screen back', async ({ page }) => {
  await page.goto('')
  await openFixture(page)

  await startSampling(page)
  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  await openFixture(page, () => page.getByRole('menuitem', { name: /^Open a \.canopi file…/ }).click())

  const frames = await samples(page)
  const startScreen = frames.findIndex((frame) => frame.startScreen)
  expect(startScreen, `frame ${startScreen} shows the start screen during the switch`).toBe(-1)
})

test('a reload that restores the latest Draft never shows the start screen, nor the chrome over an empty map', async ({ page }) => {
  await page.goto('')
  await openFixture(page)

  // Leaving the page writes the Draft; the reload reopens it before the canvas mounts, so the start screen's buttons would
  // replace a Design the user never left.
  await page.addInitScript(sampleEveryFrame)
  await page.reload()
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expectCanvasDrawn(page)

  const frames = await samples(page)
  const startScreen = frames.findIndex((frame) => frame.startScreen)
  expect(startScreen, `frame ${startScreen} shows the start screen after the reload`).toBe(-1)
  const chromeOverEmptyMap = frames.findIndex((frame) => frame.chromeShown && !frame.sceneDrawn)
  expect(chromeOverEmptyMap, 'the chrome never shows before the scene is drawn').toBe(-1)
})

test('a New Design\'s place field has keyboard focus once the Design shows', async ({ page }) => {
  await page.goto('')
  await page.locator('[data-start-screen]').getByRole('button', { name: 'New Design' }).first().focus()
  await page.keyboard.press('Enter')

  // Its autofocus runs while the opening Design is still hidden behind the start screen; it must survive the reveal.
  await expect(page.locator('[data-start-screen]')).toHaveCount(0)
  await expect(page.locator('[data-site-locate]').getByRole('combobox', { name: 'Place or coordinates' })).toBeFocused()
})

test('the transparent chrome of a hidden Design takes no pointer input, even where a part asks for it', async ({ page }) => {
  await page.goto('')
  await openFixture(page)

  // The hidden window lasts until the first scene is drawn, too short to sample reliably, so the canvas area is given the
  // attribute the reveal sets: what is under test is the cascade. The probe sets pointer-events: auto inline and stands for
  // chrome whose stylesheet does (the place card row, the map notice's Retry).
  const takesPointer = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="web-canvas-workspace-surface"]')!.parentElement!
    const probe = document.createElement('div')
    probe.innerHTML = '<div><button type="button" style="pointer-events: auto" data-probe>probe</button></div>'
    area.append(probe)
    area.setAttribute('data-design-hidden', '')
    const found = [...area.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.closest('[data-start-screen]') === null && getComputedStyle(element).pointerEvents !== 'none')
      .map((element) => element.outerHTML.slice(0, 120))
    area.removeAttribute('data-design-hidden')
    probe.remove()
    return found
  })
  expect(takesPointer).toEqual([])
})

test('the title bar shows what the start screen shows until the hidden Design shows', async ({ page }) => {
  await page.goto('')
  await openFixture(page)

  // As above, the canvas area is given the attribute the reveal sets: the Design's name, save status and place field sit
  // outside the canvas area, yet must not show over the start screen nor take its clicks while the Design loads.
  const visibleWhileHidden = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="web-canvas-workspace-surface"]')!.parentElement!
    const titleBar = document.querySelector('[data-workspace-title-bar]')!
    const parts = {
      name: titleBar.querySelector<HTMLElement>('[aria-label^="Rename Design"]')!,
      saveStatus: titleBar.querySelector<HTMLElement>('[data-save-status]')!,
      placeField: titleBar.querySelector<HTMLElement>('[role="combobox"]')!,
      menus: titleBar.querySelector<HTMLElement>('[role="menubar"]')!,
    }
    const shown = (element: HTMLElement) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      && getComputedStyle(element).pointerEvents !== 'none'
    area.setAttribute('data-design-hidden', '')
    const hidden = Object.fromEntries(Object.entries(parts).map(([name, element]) => [name, shown(element)]))
    area.removeAttribute('data-design-hidden')
    const revealed = Object.fromEntries(Object.entries(parts).map(([name, element]) => [name, shown(element)]))
    return { hidden, revealed }
  })
  expect(visibleWhileHidden).toEqual({
    hidden: { name: false, saveStatus: false, placeField: false, menus: true },
    revealed: { name: true, saveStatus: true, placeField: true, menus: true },
  })
})

// canopi-23p2: in a New Design's overview the Start card, its found-place chip and the top-centre chip slot share one row
// (SiteOnboarding), so the overview notice never covers the card, and every chip stays on screen and clear of the panels.
for (const size of [{ width: 360, height: 740 }, { width: 768, height: 800 }, { width: 1400, height: 900 }]) {
  test(`a New Design's top chips sit beside the Start card, on screen and clear of the panels, at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('')
    await page.locator('[data-start-screen]').getByRole('button', { name: 'New Design' }).first().click()
    await page.locator('[data-site-locate]').getByRole('button', { name: 'Skip, I’ll find it on the map' }).click()
    await expect(page.locator('[data-start-design]')).toBeVisible()
    await expect(page.locator('[data-overview-notice]')).toBeVisible()

    const rects = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const { left, top, right, bottom } = element.getBoundingClientRect()
        return { left, top, right, bottom }
      }
      const found = document.querySelector('[data-found-site]')
      const slot = document.querySelector('[data-top-chip-slot]')
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        notice: box('[data-overview-notice]'),
        found: box('[data-found-site]'),
        card: box('[data-start-design]'),
        rail: box('nav[aria-label="Web Edition panels"]'),
        foundInRow: found?.parentElement?.hasAttribute('data-start-row') ?? false,
        slotInRow: slot?.parentElement?.hasAttribute('data-start-row') ?? false,
        foundInSlot: slot?.contains(found ?? null) ?? false,
      }
    })
    expect(rects.foundInRow, 'the found-place chip is a child of the Start row').toBe(true)
    expect(rects.slotInRow, 'the top-centre slot is a child of the Start row').toBe(true)
    expect(rects.foundInSlot, 'the found-place chip is beside the slot, not in it').toBe(false)
    const { viewport, notice, found, card, rail } = rects
    for (const [name, chip] of [['overview notice', notice], ['found-place chip', found]] as const) {
      expect(chip, name).not.toBeNull()
      expect(chip!.left, `${name} left edge on screen`).toBeGreaterThanOrEqual(0)
      expect(chip!.top, `${name} top edge on screen`).toBeGreaterThanOrEqual(0)
      expect(chip!.right, `${name} right edge on screen`).toBeLessThanOrEqual(viewport.width)
      expect(chip!.bottom, `${name} bottom edge on screen`).toBeLessThanOrEqual(viewport.height)
      if (rail && rail.right > rail.left) expect(chip!.right, `${name} left of the panel rail`).toBeLessThanOrEqual(rail.left)
    }
    const overlaps = notice!.left < card!.right && card!.left < notice!.right && notice!.top < card!.bottom && card!.top < notice!.bottom
    expect(overlaps, 'the overview notice does not cover the Start card').toBe(false)
  })
}
