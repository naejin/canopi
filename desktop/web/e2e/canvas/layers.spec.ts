// The Web Edition's Layers panel (canopi-f47t.42, plan section 4, "Surfaces and checks": w1, w2). The Web build opens
// a Design with three site data entries (fixtures/layers-web.canopi). Layers has no Site data button and no Site data
// panel on the Web; its summary row says how many terrain or height layers the Design has and that they need Canopi
// Desktop. Opening a Design row shows its opacity under it; the slider drags in both engines (WebKit's range input
// is the one the plan's probe doubts). DOM assertions only, no baselines.
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { designMap, expectCanvasDrawn } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/layers-web.canopi', import.meta.url))

async function openLayersFixture(page: Page): Promise<Locator> {
  await page.goto('')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click(),
  ])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  await expectCanvasDrawn(page)
  await page.getByRole('button', { name: /^Layers\b/ }).first().click()
  const panel = page.getByRole('complementary', { name: 'Layers' })
  await expect(panel).toBeVisible()
  return panel
}

/** Where a range input's thumb centre sits for `value` (0–100), from the thumb size the slider is drawn with. */
async function thumbX(slider: Locator, value: number): Promise<{ x: number, y: number }> {
  const box = await slider.boundingBox()
  if (!box) throw new Error('the slider has no box')
  const thumb = box.height
  return { x: box.x + thumb / 2 + (box.width - thumb) * value / 100, y: box.y + box.height / 2 }
}

test.describe('Layers on the Web Edition', () => {
  test('w1: the Zones opacity slider drags from 100 % to 20 % with the row open and focused', async ({ page }) => {
    const panel = await openLayersFixture(page)
    const slider = panel.getByRole('slider', { name: 'Opacity: Zones' })
    await expect(slider).toBeVisible()
    await expect(slider).toHaveAttribute('aria-valuetext', '100%')
    await slider.focus()
    const from = await thumbX(slider, 100)
    const to = await thumbX(slider, 20)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
    await expect(slider).toHaveValue('20')
    await expect(slider).toHaveAttribute('aria-valuetext', '20%')
    await expect(slider).toBeFocused()
  })
})
