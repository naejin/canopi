// An opened Design shows in the frame its first scene is drawn (app/canvas-map-surface/design-reveal.ts): until then the
// start screen stays up and the Design's chrome is laid out but hidden, so its chrome never sits over an empty map. The
// unit tests drive the signal through a stub renderer; this scenario samples every animation frame of the real page while a
// Design opens, cold and again after Close Design, and checks that no frame shows the map with neither the start screen nor
// the drawn scene. The map is aria-busy until its renderer has drawn the latest scene (support/canvas.ts).
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
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const page = window as unknown as { __revealSamples?: FrameSample[] }
    const sampling = page.__revealSamples !== undefined
    page.__revealSamples = []
    if (sampling) return
    const sample = () => {
      const rail = document.querySelector('[data-tool-rail]')
      const map = document.querySelector('[role="application"]')
      page.__revealSamples!.push({
        startScreen: document.querySelector('[data-start-screen]') !== null,
        chromeShown: rail !== null && getComputedStyle(rail).visibility === 'visible',
        sceneDrawn: map !== null && map.getAttribute('aria-busy') !== 'true',
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

/** The frames sampled since startSampling, once a frame has sampled the shown Design. */
async function samples(page: Page): Promise<FrameSample[]> {
  const read = () => page.evaluate(() => (window as unknown as { __revealSamples: FrameSample[] }).__revealSamples.slice())
  await expect.poll(async () => (await read()).some((frame) => frame.chromeShown), 'a frame sampled the shown Design').toBe(true)
  return read()
}

async function openFixture(page: Page): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click(),
  ])
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
