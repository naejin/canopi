// Site data values and the pin in real engines (canopi-f47t.42, plan section 4 "Surfaces and checks", g3): each shown,
// ready row reads the memory backend's analytic site under the mouse; a hidden row shows nothing; "—" where the data has
// none; a click on empty ground pins (the header's coordinates, Unpin); a click on a zone selects it and pins nothing; and
// with `sampleDelay=` an answer a newer point superseded never shows. The analytic site covers the west of the fixture
// Design (about 18 % to 45 % of the map's width; the planting east of it has no data), the tool rail covers the left
// sixth and Site data the right third. The gallery runs no canvas key router, so Esc's unpin is checked through the real
// Esc chain in jsdom (app/lidar/site-transients.test.ts). DOM assertions only, no baselines.
import type { Locator, Page } from '@playwright/test'
import { expect, openGallery, test } from '../support/gallery'

function siteData(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Site data' })
}

/** A row's value: the text at its end (empty while it shows none). */
function value(page: Page, id: string): Locator {
  return siteData(page).locator(`[data-site-row="${id}"] [data-trailing]`)
}

/** The map, and a point at a fraction of its box. */
async function mapPoints(page: Page): Promise<(fx: number, fy: number) => { x: number, y: number }> {
  const box = await page.getByRole('application', { name: 'Design map' }).boundingBox()
  if (!box) throw new Error('no map')
  return (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
}

const METRES = /^\d+(\.\d+)? m$/
const DEGREES = /^\d+(\.\d+)?°$/
/** Empty ground on the analytic site, west of the planting and clear of its plants, and off it (east of the planting). */
const ON_DATA = [[0.2, 0.4], [0.27, 0.75]] as const
const OFF_DATA = [0.55, 0.55] as const

test.describe('Site data values (g3)', () => {
  test('values follow the mouse, a hidden row shows none, and "—" where the data has none', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const at = await mapPoints(page)
    const ground = value(page, 'lidar-ground')
    const slope = value(page, 'lidar-slope')

    await page.mouse.move(at(...ON_DATA[0]).x, at(...ON_DATA[0]).y)
    await expect(ground).toHaveText(METRES)
    await expect(slope).toHaveText(DEGREES)
    const first = await ground.textContent()
    await page.mouse.move(at(...ON_DATA[1]).x, at(...ON_DATA[1]).y)
    await expect(ground).toHaveText(METRES)
    await expect(ground).not.toHaveText(first!)

    // The hidden Slope (%) row reads nothing.
    await expect(value(page, 'lidar-slope-percent')).not.toHaveText(/\d/)
    await siteData(page).locator('[data-site-row="lidar-slope"]').getByRole('button', { name: /^Hide / }).click()
    await page.mouse.move(at(...ON_DATA[0]).x, at(...ON_DATA[0]).y)
    await expect(ground).toHaveText(METRES)
    await expect(slope).toHaveText('')

    await page.mouse.move(at(...OFF_DATA).x, at(...OFF_DATA).y)
    await expect(ground).toHaveText('—')
    await expect(siteData(page).locator('[data-site-row="lidar-ground"]').getByRole('img', { name: 'No data' })).toBeVisible()
  })

  test('a click on empty ground pins it with its coordinates, and Unpin ends it', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const at = await mapPoints(page)
    const panel = siteData(page)
    await expect(panel.getByText('Point at the map to read values · click to pin')).toBeVisible()

    await page.mouse.click(at(...ON_DATA[0]).x, at(...ON_DATA[0]).y)
    await expect(panel.getByText(/^\d+\.\d{6}° N, \d+\.\d{6}° E$/)).toBeVisible()
    const pinned = await value(page, 'lidar-ground').textContent()
    expect(pinned).toMatch(METRES)
    // Off the map the rows read the pin.
    await page.mouse.move(at(...ON_DATA[1]).x, at(...ON_DATA[1]).y)
    await expect(value(page, 'lidar-ground')).not.toHaveText(pinned!)
    const off = await panel.getByRole('heading', { name: 'Site data' }).boundingBox()
    await page.mouse.move(off!.x + 4, off!.y + 4)
    await expect(value(page, 'lidar-ground')).toHaveText(pinned!)

    await panel.getByRole('button', { name: 'Unpin' }).click()
    await expect(panel.getByRole('button', { name: 'Unpin' })).toHaveCount(0)
    await expect(value(page, 'lidar-ground')).toHaveText('')
  })

  test('a click on a zone selects it and pins nothing', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const at = await mapPoints(page)
    const panel = siteData(page)
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /^Rectangle zone( \(.\))?$/ }).click()
    // Below the planting, so the click inside it lands on the zone's fill and on no plant.
    const [from, to] = [at(0.24, 0.74), at(0.4, 0.86)]
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /^Select( \(.\))?$/ }).click()
    const chip = page.getByRole('group', { name: 'Selection' })
    await chip.getByRole('button', { name: 'Clear selection' }).click()
    await expect(chip).toHaveCount(0)
    await page.mouse.click(at(0.32, 0.8).x, at(0.32, 0.8).y)
    await expect(chip).toContainText('Rectangle zone')
    await expect(panel.getByRole('button', { name: 'Unpin' })).toHaveCount(0)
    // Off the map, with no pin, the rows read nothing.
    const off = await panel.getByRole('heading', { name: 'Site data' }).boundingBox()
    await page.mouse.move(off!.x + 4, off!.y + 4)
    await expect(value(page, 'lidar-ground')).toHaveText('')
    await expect(panel.getByText('Point at the map to read values · click to pin')).toBeVisible()
  })

  test('with sampleDelay, a point a newer one replaced while it waited is never read', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', sampleDelay: '2000' })
    const at = await mapPoints(page)
    const ground = value(page, 'lidar-ground')
    // Every value the row shows from the first move on.
    await siteData(page).locator('[data-site-row="lidar-ground"]').evaluate((row) => {
      const read = () => row.querySelector('[data-trailing]')?.textContent ?? ''
      const seen: string[] = [read()]
      ;(window as unknown as { __groundTexts: string[] }).__groundTexts = seen
      new MutationObserver(() => seen.push(read())).observe(row, { childList: true, characterData: true, subtree: true })
    })
    // A is read (its answer still lands: a running read is never cut short); B waits behind it and C replaces it.
    const [a, b] = [at(...ON_DATA[0]), at(...ON_DATA[1])]
    await page.mouse.move(a.x, a.y)
    await page.waitForTimeout(150)
    await page.mouse.move(b.x, b.y)
    await page.waitForTimeout(150)
    await page.mouse.move(at(...OFF_DATA).x, at(...OFF_DATA).y)
    await expect(ground).toHaveText('—')
    await page.waitForTimeout(500)
    const seen = await page.evaluate(() => (window as unknown as { __groundTexts: string[] }).__groundTexts)
    expect(seen.at(-1)).toBe('—')

    // B's own value, read now, never showed.
    await page.mouse.move(b.x, b.y)
    await expect(ground).toHaveText(METRES)
    const atB = await ground.textContent()
    expect(seen.filter((text) => METRES.test(text)), `B's ${atB} never landed: ${JSON.stringify(seen)}`).not.toContain(atB)
  })
})
