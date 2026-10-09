// The gallery states and fixtures the Layers redesign's streams build their checks on (canopi-f47t.42, plan section 4,
// commit 0): the Site data surface and its states, the analytic `lidar_sample_points` fixture, and `lidar-raster`, where
// Desktop's raster renderer draws the Rust engine's display COG on the real map (architecture review finding 15). The
// streams' own specs (layers, site-list, display, values, profile, library) assert their surfaces; this one only holds
// what they share. DOM and pixel assertions, no baselines.
import type { Locator, Page } from '@playwright/test'
import { expect, openGallery, test } from '../support/gallery'

/** The memory backend's `invoke`, imported in the page from the module the app's Tauri alias resolves to. */
async function invokeInPage(page: Page, command: string, args: Record<string, unknown>): Promise<{ ok: unknown } | { failed: true }> {
  return page.evaluate(async ({ command, args }) => {
    const url = '/memory-backend.ts'
    const backend = await import(url) as { invoke(command: string, args: Record<string, unknown>): Promise<unknown> }
    try {
      return { ok: await backend.invoke(command, args) }
    } catch {
      return { failed: true as const }
    }
  }, { command, args })
}

/** The map's pixels as PNG bytes. */
async function mapPixels(map: Locator): Promise<Buffer> {
  return map.screenshot({ animations: 'disabled' })
}

test.describe('the UI gallery for Site data', () => {
  test('lidar-raster draws the Rust engine\'s display COG through Desktop\'s raster renderer, and hiding it repaints', async ({ page }) => {
    const cog = page.waitForResponse((response) => response.url().includes('rust-display-cog.tif') && response.ok())
    await openGallery(page, { surface: 'site-data', state: 'lidar-raster' })
    await cog
    const map = page.getByRole('application', { name: 'Design map' })
    // The renderer decodes in its worker and draws on a later frame: wait until two captures agree.
    let drawn = await mapPixels(map)
    await expect.poll(async () => {
      const next = await mapPixels(map)
      const settled = next.equals(drawn)
      drawn = next
      return settled
    }, { timeout: 20_000 }).toBe(true)
    // The row's eye (the open item's settings repeat it below the list).
    await page.getByRole('button', { name: 'Hide IGN ground elevation' }).first().click()
    await expect.poll(async () => (await mapPixels(map)).equals(drawn), { timeout: 20_000 }).toBe(false)
  })

  test('opens the Site data panel on its states: an item opened among twelve, and two missing items', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', state: 'lidar-long', open: 'lidar-block-7' })
    const panel = page.getByRole('complementary', { name: 'Site data' })
    await expect(panel.getByText('Survey block 7 · access track', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await openGallery(page, { surface: 'site-data', state: 'lidar-missing' })
    // Five entries, two of them in no library on this computer (stream B words their rows).
    await expect(page.getByRole('complementary', { name: 'Site data' }).getByRole('listitem')).toHaveCount(5)
  })

  test('opens the Data library with no Design open, and the long library with forty items', async ({ page }) => {
    await openGallery(page, { surface: 'library', state: 'no-design' })
    await expect(page.getByRole('dialog', { name: 'Data library' })).toBeVisible()
    await openGallery(page, { surface: 'library', state: 'long' })
    await expect(page.getByRole('dialog', { name: 'Data library' }).getByRole('option', { name: /^IGN LiDAR HD MNT tile 0470_6836/ })).toBeAttached()
  })

  test('the analytic sampler answers within the generated caps and never exceeds them', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const ground = { kind: 'Source', entity_id: 'lidar-ground', expected_generation_id: 'lidar-ground-g1' }
    // The data covers the west of the fixture site (13° E, 23° N); 0.0005° east is off it.
    const answer = await invokeInPage(page, 'lidar_sample_points', {
      request: {
        targets: [ground, { ...ground, expected_generation_id: 'lidar-ground-g0' }, { kind: 'Derived', entity_id: 'lidar-slope', expected_generation_id: 'lidar-slope-g1' }],
        points: [[12.99995, 23.00005], [13.0005, 23.00005]],
      },
    })
    expect(answer).toEqual({
      ok: [
        { Values: { values: [expect.any(Number), null] } },
        { Unavailable: { reason: 'StaleGeneration' } },
        { Values: { values: [expect.any(Number), null] } },
      ],
    })
    const [elevation] = (answer as { ok: [{ Values: { values: [number] } }] }).ok[0].Values.values
    expect(elevation).toBeGreaterThanOrEqual(110)
    expect(elevation).toBeLessThanOrEqual(170)

    const nine = await invokeInPage(page, 'lidar_sample_points', { request: { targets: Array(9).fill(ground), points: [[13, 23]] } })
    expect(nine).toEqual({ failed: true })
    const tooLong = await invokeInPage(page, 'lidar_sample_points', { request: { targets: [ground], points: Array(4097).fill([13, 23]) } })
    expect(tooLong).toEqual({ failed: true })
  })
})
