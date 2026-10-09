// An open Site data item's display in real engines (canopi-f47t.42, plan section 4, stream B, g4; architecture review
// finding 15). `state=lidar-raster` draws the Rust engine's display COG through Desktop's raster renderer
// (maplibre-gl-raster over the cog-tiler worker pool) on the real map, so a restyle is seen in pixels, not in a fake
// layer manager: Reverse and a Custom range typed in the open item each repaint the raster in Chromium and WebKit. The
// renderer's opt-in timeline (`raster-display/diagnostics.ts`) says when its worker has rendered tiles: the map holds a
// steady picture for seconds before the first tile lands, so a settled capture alone can be the empty map. The rest
// is DOM: each kind's ramps, Reset only off the default, Custom only for a valid pair with the fr comma, and an
// opacity drag that keeps the item open. No baselines.
import type { Locator, Page } from '@playwright/test'
import { expect, openGallery, test } from '../support/gallery'

/** The map's pixels as PNG bytes, the dock panels over it masked (a pressed or focused control is not a repaint). */
async function mapPixels(map: Locator): Promise<Buffer> {
  return map.screenshot({ animations: 'disabled', mask: [map.page().locator('aside')] })
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

async function openRaster(page: Page): Promise<{ map: Locator }> {
  await page.addInitScript(() => localStorage.setItem('canopi.rasterDiagnostics', '1'))
  const cog = page.waitForResponse((response) => response.url().includes('rust-display-cog.tif') && response.ok())
  await openGallery(page, { surface: 'site-data', state: 'lidar-raster' })
  await cog
  const map = page.getByRole('application', { name: 'Design map' })
  await settled(page, map, 0)
  return { map }
}

function siteData(page: Page): Locator {
  return page.locator('aside').filter({ has: page.locator('[data-site-line]') })
}

/** Opens the ground elevation's settings under its row. */
async function openGround(page: Page): Promise<Locator> {
  const ground = siteData(page).locator('[data-site-row="lidar-ground"]')
  await ground.locator('[data-control="name"]').click()
  await expect(ground.locator('[data-control="name"]')).toHaveAttribute('aria-expanded', 'true')
  return ground
}

test.describe('an open Site data item\'s display on the real renderer', () => {
  test('Reverse repaints the raster, and turning it off again paints the first picture', async ({ page }) => {
    const { map } = await openRaster(page)
    const ground = await openGround(page)
    const drawn = await settled(page, map, 0)
    const reverse = ground.getByRole('button', { name: 'Reverse' })
    let before = await renderedTiles(page)
    await reverse.click()
    await expect(reverse).toHaveAttribute('aria-pressed', 'true')
    const reversed = await settled(page, map, before)
    expect(reversed.equals(drawn), 'Reverse repaints the raster').toBe(false)
    before = await renderedTiles(page)
    await reverse.click()
    const back = await settled(page, map, before)
    expect(back.equals(drawn), 'Reverse off paints the first picture again').toBe(true)
  })

  test('a Custom range typed in the open item repaints the raster', async ({ page }) => {
    const { map } = await openRaster(page)
    const ground = await openGround(page)
    const drawn = await settled(page, map, 0)
    const before = await renderedTiles(page)
    // The COG's values span 19.75–90.25 m; a band in the middle saturates both ends.
    await ground.getByRole('textbox', { name: 'Minimum' }).fill('45')
    await ground.getByRole('textbox', { name: 'Minimum' }).press('Enter')
    await expect(ground.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
    const custom = await settled(page, map, before)
    expect(custom.equals(drawn), 'a Custom range repaints the raster').toBe(false)
  })
})

test.describe('an open Site data item\'s settings', () => {
  test('offer each kind\'s ramps, and Reset only while the display differs from the kind\'s', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const ground = await openGround(page)
    await expect(ground.getByRole('radiogroup', { name: 'Colors' }).getByRole('radio')).toHaveText(['', '', ''])
    const ramps = async (scope: Locator) => scope.getByRole('radiogroup', { name: 'Colors' }).getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.getAttribute('aria-label')))
    expect(await ramps(ground)).toEqual(['Terrain', 'Earth', 'Gray'])
    await expect(ground.getByRole('button', { name: 'Reset' })).toHaveCount(0)
    await ground.getByRole('radio', { name: 'Gray' }).click()
    await expect(ground.getByRole('radio', { name: 'Gray' })).toHaveAttribute('aria-checked', 'true')
    await ground.getByRole('button', { name: 'Reset' }).click()
    await expect(ground.getByRole('radio', { name: 'Terrain' })).toHaveAttribute('aria-checked', 'true')
    await expect(ground.getByRole('button', { name: 'Reset' })).toHaveCount(0)

    const slope = siteData(page).locator('[data-site-row="lidar-slope"]')
    await slope.locator('[data-control="name"]').click()
    expect(await ramps(slope)).toEqual(['Yellow–red', 'Magma', 'Gray'])
    // A slope's fixed 0–30° default reads as Custom, with no Reset.
    await expect(slope.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
    await expect(slope.getByRole('button', { name: 'Reset' })).toHaveCount(0)
  })

  test('commit Custom only for a valid pair, with the French decimal comma', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', locale: 'fr' })
    const ground = await openGround(page)
    const minimum = ground.getByRole('textbox', { name: 'Minimum' })
    const maximum = ground.getByRole('textbox', { name: 'Maximum' })
    const top = await maximum.inputValue()
    await minimum.fill('140,5')
    await minimum.press('Enter')
    await expect(ground.getByRole('radio', { name: 'Personnalisée' })).toHaveAttribute('aria-checked', 'true')
    await expect(minimum).toHaveValue('140,5')
    // A minimum above the maximum stays a draft while focus moves to the other end,
    // and reverts with it once focus leaves the pair with no valid pair.
    await minimum.fill('9999')
    await minimum.press('Tab')
    await expect(maximum).toBeFocused()
    await expect(minimum).toHaveValue('9999')
    await maximum.press('Tab')
    await expect(maximum).not.toBeFocused()
    await expect(minimum).toHaveValue('140,5')
    await expect(maximum).toHaveValue(top)
    await expect(ground.getByRole('radio', { name: 'Personnalisée' })).toHaveAttribute('aria-checked', 'true')
  })

  test('keep the item open while its opacity is dragged', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const ground = await openGround(page)
    const slider = ground.getByRole('slider', { name: 'Opacity: IGN ground elevation' })
    const box = await slider.boundingBox()
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(slider).toHaveValue(/^(1\d|2\d)$/)
    await expect(ground.locator('[data-control="name"]')).toHaveAttribute('aria-expanded', 'true')
  })
})
