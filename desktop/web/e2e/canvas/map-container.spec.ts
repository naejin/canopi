// The map container after a real map is destroyed (canvas v2 2.0 cleanup, A15). MapLibre adds its canvas
// and control containers to the Design map element, and the map host removes what a creation added
// when the map goes (maplibre/host.ts); a leftover would stack a second map under the new one. The
// jsdom tests cover a failed constructor only; these run the real MapLibre teardown in the browser:
// a Design switch, and a lost WebGL context followed by the user's Retry.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { designMap, expectCanvasDrawn } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** Marks the map canvas of the map about to be destroyed, so a check can see it is gone. */
const OLD_MAP = 'data-e2e-old-map'

async function openFixture(page: Page, open: () => Promise<void>): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open()])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  // The opening camera frames the Design.
  await expect(page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: /^Map scale/ })).toHaveText('1:240')
  await expectCanvasDrawn(page)
}

async function openBaseFixture(page: Page): Promise<void> {
  await page.goto('')
  await openFixture(page, () => page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click())
}

/**
 * The Design map's children, as sorted tag and class names, and the MapLibre parts in the whole page.
 * Read in one pass in the page.
 */
async function readMapContainer(page: Page) {
  return designMap(page).evaluate((container) => ({
    children: Array.from(container.children, (child) => `${child.tagName}.${child.className}`).sort(),
    maps: document.querySelectorAll('.maplibregl-map').length,
    canvasContainers: document.querySelectorAll('.maplibregl-canvas-container').length,
    controlContainers: document.querySelectorAll('.maplibregl-control-container').length,
    canvases: document.querySelectorAll('canvas.maplibregl-canvas').length,
  }))
}

async function markCurrentMap(page: Page): Promise<void> {
  await page.locator('canvas.maplibregl-canvas').evaluate((canvas, name) => canvas.setAttribute(name, ''), OLD_MAP)
}

async function expectOneMapAsOpened(page: Page, opened: Awaited<ReturnType<typeof readMapContainer>>): Promise<void> {
  await expect(page.locator(`[${OLD_MAP}]`), 'the old map was destroyed, not kept').toHaveCount(0)
  await expect(designMap(page)).toBeVisible()
  await expect(page.locator('canvas.maplibregl-canvas'), 'the new map is built').toHaveCount(1)
  await expectCanvasDrawn(page)
  const container = await readMapContainer(page)
  expect(container, 'exactly one map canvas container, and no children left from the old map').toEqual({
    ...opened,
    maps: 1,
    canvasContainers: 1,
    controlContainers: 1,
    canvases: 1,
  })
}

test('a Design switch leaves exactly one map in the map container', async ({ page }) => {
  await openBaseFixture(page)
  const opened = await readMapContainer(page)
  expect(opened.canvasContainers, 'the opened Design has one map').toBe(1)

  await markCurrentMap(page)
  await page.getByRole('menubar', { name: 'Menus' }).getByRole('menuitem', { name: 'File' }).click()
  await openFixture(page, () => page.getByRole('menuitem', { name: /^Open a \.canopi file…/ }).click())
  await expectOneMapAsOpened(page, opened)
})

test.describe('a map that stops drawing', () => {
  test.use({ expectedConsoleErrors: ['Shared workspace map failed: Error: MapLibre WebGL context was lost'] })

  test('Retry rebuilds exactly one map in the map container', async ({ page }) => {
    await openBaseFixture(page)
    const opened = await readMapContainer(page)
    expect(opened.canvasContainers, 'the opened Design has one map').toBe(1)

    await markCurrentMap(page)
    await page.locator('canvas.maplibregl-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const lose = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
      if (!lose) throw new Error('the map canvas has no WEBGL_lose_context')
      lose.loseContext()
    })
    const stopped = page.getByText('The map stopped drawing. Your Design is safe.')
    await expect(stopped).toBeVisible()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(stopped).toBeHidden()
    await expectOneMapAsOpened(page, opened)
  })
})
