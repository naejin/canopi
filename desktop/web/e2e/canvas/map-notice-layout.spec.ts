// The map notice keeps clear of the zoom group in every layout (live-bugs step, item 3). Offline, the Web Edition shows
// "Basemap couldn't load" with Retry in the bottom row, between the view chip and the zoom group; Show my location made
// the Web zoom group wider, so at iPad-landscape widths the group covered Retry. Each layout below opens a Design,
// then checks with a real hit test that Retry is what a click at its centre reaches and that the notice shares no pixel
// with the zoom group or the view chip (offline there are no map credits; map-container.spec.ts keeps the notice clear
// of them). The notice is bottom chrome on the visible-map-area seam: with everything selected, the selection chip sits
// above it and Retry still takes the click. In the bottom row it never moves the opening framing: the Design opens in
// the same frame as with the basemap hidden, when no notice shows. Both engines; no baselines.
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { designMap, expectCanvasDrawn, pressMod } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))

interface Box { readonly x: number, readonly y: number, readonly width: number, readonly height: number }

const WIDE_LAYOUTS = [
  { width: 1024, height: 768 },
  { width: 1060, height: 800 },
  { width: 1400, height: 900 },
  // The narrowest window that keeps the wide layout: the notice stands above the bottom row there (max-width 760px).
  { width: 700, height: 500 },
] as const

for (const viewport of WIDE_LAYOUTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('Retry takes the click at its centre and the notice clears the zoom group and the view chip', async ({ page }) => {
      await openBaseFixture(page)
      const { notice, retry } = await expectNoticeWithRetry(page)
      await expectRetryHit(retry)
      const noticeBox = await boxOf(notice)
      for (const [name, chrome] of [
        ['the zoom group', page.getByRole('group', { name: 'Zoom' })],
        ['the view chip', page.locator('[data-view-chip]')],
      ] as const) {
        await expect(chrome).toBeVisible()
        expect(overlap(noticeBox, await boxOf(chrome)), `the notice clears ${name}`).toBe(false)
      }
    })

    test('the selection chip and the visible map frame clear the notice', async ({ page }) => {
      await openBaseFixture(page)
      const { notice, retry } = await expectNoticeWithRetry(page)
      await designMap(page).focus()
      await pressMod(page, 'a')
      const selection = page.locator('[data-selection-chip]')
      await expect(selection).toBeVisible()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expectRetryHit(retry)
      const noticeBox = await boxOf(notice)
      expect(overlap(noticeBox, await boxOf(selection)), 'the notice clears the selection chip').toBe(false)
      // The notice is bottom chrome on the visible-map-area seam wherever it shows: framing and chips avoid it.
      const frameBottom = (await visibleMapFrame(page)).bottom
      expect(frameBottom, 'the visible map frame ends above the notice').toBeLessThanOrEqual(Math.ceil(noticeBox.y))
    })
  })
}

test.describe('1024x768 opening framing', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('the notice in the bottom row leaves the Design’s opening frame as it is with no notice', async ({ page, context }) => {
    // input-probe.spec.ts and touch.spec.ts tap fixed places of the opening camera at 1024x768, with the notice showing.
    await openBaseFixture(page)
    const { notice } = await expectNoticeWithRetry(page)
    const zoomGroup = await boxOf(page.getByRole('group', { name: 'Zoom' }))
    expect((await boxOf(notice)).y, 'the notice stands no higher than the zoom group').toBeGreaterThanOrEqual(zoomGroup.y - 0.5)
    const withNotice = await visibleMapFrame(page)
    // WebKit opens no file chooser from a page behind another: the second open runs alone.
    await page.close()

    const quiet = await context.newPage()
    await quiet.bringToFront()
    await quiet.addInitScript(() => {
      // A fresh browser (the first open's draft would reopen with its camera), whose Web Edition settings record
      // (web/browser-app-data.ts) hides the basemap: no notice shows.
      localStorage.clear()
      localStorage.setItem('canopi:web-app-data:v2:settings', JSON.stringify({ version: 2, settings: { basemap_visible: false } }))
    })
    await openBaseFixture(quiet)
    await expect(quiet.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Show my location' })).toBeVisible()
    await quiet.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(quiet.locator('[data-map-notice]')).toHaveCount(0)
    expect(withNotice, 'the visible map frame the Design opens into').toEqual(await visibleMapFrame(quiet))
  })
})

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('Retry takes the tap at its centre and the notice clears the zoom column and the panel sheet', async ({ page }) => {
    await openBaseFixture(page)
    const { notice, retry } = await expectNoticeWithRetry(page)
    await expectRetryHit(retry)
    const noticeBox = await boxOf(notice)
    for (const [name, chrome] of [
      ['the zoom column', page.getByRole('group', { name: 'Zoom' })],
      ['the panel sheet', page.getByRole('region', { name: 'Panels' })],
    ] as const) {
      await expect(chrome).toBeVisible()
      expect(overlap(noticeBox, await boxOf(chrome)), `the notice clears ${name}`).toBe(false)
    }
  })
})

async function openBaseFixture(page: Page): Promise<void> {
  await page.goto('')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click(),
  ])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expectCanvasDrawn(page)
}

async function expectNoticeWithRetry(page: Page): Promise<{ notice: Locator, retry: Locator }> {
  const notice = page.locator('[data-map-notice]')
  await expect(notice).toContainText('Basemap couldn’t load')
  const retry = notice.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  // The Zoom group, Show my location included, has laid out, and the seam has placed the chrome around it.
  await expect(page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Show my location' })).toBeVisible()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return { notice, retry }
}

async function expectRetryHit(retry: Locator): Promise<void> {
  const box = await boxOf(retry)
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const hit = await retry.evaluate((button, at) => {
    const top = document.elementFromPoint(at.x, at.y)
    return top !== null && button.contains(top)
  }, centre)
  expect(hit, `a click at Retry's centre (${centre.x}, ${centre.y}) reaches Retry`).toBe(true)
}

/** The visible map frame the seam publishes on the map area (`--map-inset-*`), in page pixels. */
async function visibleMapFrame(page: Page): Promise<{ top: number, right: number, bottom: number, left: number }> {
  return await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[style*="--map-inset-bottom"]')
    if (!area) throw new Error('no map area publishes its insets')
    const box = area.getBoundingClientRect()
    const inset = (edge: string) => parseFloat(area.style.getPropertyValue(`--map-inset-${edge}`))
    return { top: box.top + inset('top'), right: box.right - inset('right'), bottom: box.bottom - inset('bottom'), left: box.left + inset('left') }
  })
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no box: the element is not laid out')
  return box
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
