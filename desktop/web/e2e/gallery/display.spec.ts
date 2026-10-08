// An open Site data item's display through the real renderer (canopi-f47t.42, plan section 4, stream B; architecture
// review finding 15). `state=lidar-raster` draws the Rust engine's display COG through Desktop's raster renderer
// (maplibre-gl-raster over the cog-tiler worker pool) on the real map, so a restyle is seen in pixels, not in a fake
// layer manager: Reverse and a Custom range each repaint the raster in Chromium and WebKit. The renderer's opt-in
// timeline (`raster-display/diagnostics.ts`) says when its worker has rendered tiles: the map holds a steady picture
// for seconds before the first tile lands, so a settled capture alone can be the empty map. DOM and pixel assertions
// within one run, no baselines.
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, openGallery, test } from '../support/gallery'

/** The Site data writer, imported in the page from the module the gallery itself loaded (Vite's /@fs/ path). */
const ACTIONS = `/@fs${fileURLToPath(new URL('../../src/app/lidar/actions.ts', import.meta.url))}`

/** The map's pixels as PNG bytes. */
async function mapPixels(map: Locator): Promise<Buffer> {
  return map.screenshot({ animations: 'disabled' })
}

/** Tiles the renderer's worker pool has rendered since the page opened. */
async function renderedTiles(page: Page): Promise<number> {
  return page.evaluate(() => {
    const timeline = (window as { __CANOPI_RASTER_DIAGNOSTICS__?: { events: { kind: string }[] } }).__CANOPI_RASTER_DIAGNOSTICS__
    return timeline?.events.filter((event) => event.kind === 'tile').length ?? 0
  })
}

/**
 * Waits until the renderer has rendered tiles beyond `after`, then until two captures in a row agree (MapLibre draws
 * them on a later frame).
 */
async function settled(page: Page, map: Locator, after: number): Promise<Buffer> {
  await expect.poll(() => renderedTiles(page), { timeout: 20_000, message: 'the renderer renders tiles' }).toBeGreaterThan(after)
  let drawn = await mapPixels(map)
  await expect.poll(async () => {
    const next = await mapPixels(map)
    const same = next.equals(drawn)
    drawn = next
    return same
  }, { timeout: 20_000 }).toBe(true)
  return drawn
}

/** Writes the ground elevation's display through the Site data writer; returns the tiles rendered before it. */
async function restyle(page: Page, display: Record<string, unknown>): Promise<number> {
  const before = await renderedTiles(page)
  await page.evaluate(async ({ url, display }) => {
    const actions = await import(url) as { setLidarEntryDisplay(id: string, display: unknown): void }
    actions.setLidarEntryDisplay('lidar-ground', display)
  }, { url: ACTIONS, display })
  return before
}

async function openRaster(page: Page): Promise<{ map: Locator, drawn: Buffer }> {
  await page.addInitScript(() => localStorage.setItem('canopi.rasterDiagnostics', '1'))
  const cog = page.waitForResponse((response) => response.url().includes('rust-display-cog.tif') && response.ok())
  await openGallery(page, { surface: 'site-data', state: 'lidar-raster' })
  await cog
  const map = page.getByRole('application', { name: 'Design map' })
  return { map, drawn: await settled(page, map, 0) }
}

test.describe('an open Site data item\'s display on the real renderer', () => {
  test('Reverse repaints the raster, and turning it off again paints the first picture', async ({ page }) => {
    const { map, drawn } = await openRaster(page)
    const reversed = await settled(page, map, await restyle(page, { reversed: true }))
    expect(reversed.equals(drawn), 'Reverse repaints the raster').toBe(false)
    const back = await settled(page, map, await restyle(page, { reversed: false }))
    expect(back.equals(drawn), 'Reverse off paints the first picture again').toBe(true)
  })

  test('a Custom range repaints the raster', async ({ page }) => {
    const { map, drawn } = await openRaster(page)
    // The COG's values span 19.75–90.25 m; a band in the middle saturates both ends.
    const custom = await settled(page, map, await restyle(page, { range: { mode: 'Custom', min: 45, max: 60 } }))
    expect(custom.equals(drawn), 'a Custom range repaints the raster').toBe(false)
  })
})
