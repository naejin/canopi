// The map notice keeps clear of the other chrome in every layout (live-bugs step, item 3). Offline, the Web Edition
// shows "Basemap couldn't load" with Retry. The notice stands above the bottom row, centred in the part of the map the
// other chrome leaves visible (the visible-map-area seam's framing frame), so the zoom group, the view chip, the rails
// and an open dock or bottom sheet never cover it: it is at most two lines tall with no panel open (never a tower of
// single words), Retry is what a click at its centre reaches, and it shares no pixel with that chrome. The notice is
// status chrome on the seam, registered with frames: false: with everything selected the selection chip sits above it,
// but it never moves the camera's framing, so a Design opened while the notice shows opens in the same frame as one
// opened with the basemap hidden, when no notice shows. Both engines; no baselines.
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { pressMod } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** The Web Edition's settings record (web/browser-app-data.ts); its settings are merged over the defaults. */
const SETTINGS_KEY = 'canopi:web-app-data:v2:settings'
/** The notice's widest place (its max-width in Panels.module.css). */
const NOTICE_MAX_WIDTH_PX = 480
const CHROME_INSET_PX = 12

interface Box { readonly x: number, readonly y: number, readonly width: number, readonly height: number }

const LAYOUTS: ReadonlyArray<{ readonly width: number, readonly height: number, readonly locale?: string }> = [
  { width: 1400, height: 900 },
  { width: 1200, height: 800 },
  { width: 1200, height: 800, locale: 'de' },
  { width: 1100, height: 800 },
  { width: 1024, height: 768 },
  { width: 1024, height: 768, locale: 'de' },
  // The band where a notice in the bottom row became a tower of single words (761 to about 1000 px).
  { width: 900, height: 700 },
  { width: 800, height: 700 },
  { width: 761, height: 700 },
  // The narrowest window that keeps the wide layout; an open panel is a bottom sheet there.
  { width: 700, height: 500 },
]

for (const { width, height, locale = 'en' } of LAYOUTS) {
  test.describe(`${width}x${height} ${locale}`, () => {
    test.use({ viewport: { width, height } })

    test('the notice stands above the bottom row, centred in the visible map, at most two lines tall, and Retry takes the click at its centre', async ({ page }) => {
      await openBaseFixture(page, { locale })
      const { notice, retry } = await expectNoticeWithRetry(page)
      await expectRetryHit(retry)
      const noticeBox = await boxOf(notice)
      const zoomGroup = await boxOf(page.locator('[data-zoom-group]'))
      const viewChip = await boxOf(page.locator('[data-view-chip]'))
      for (const [name, chrome] of [['the zoom group', zoomGroup], ['the view chip', viewChip]] as const) {
        expect(overlap(noticeBox, chrome), `the notice clears ${name}`).toBe(false)
      }
      expect(await lineCount(notice), 'the sentence takes at most two lines').toBeLessThanOrEqual(2)
      expect(noticeBox.y + noticeBox.height, 'the notice stands above the bottom row').toBeLessThanOrEqual(Math.min(zoomGroup.y, viewChip.y) + 0.5)
      // The rails cover the map's sides; the notice's bottom raises only the chips' bottom inset, not their sides.
      const frame = await chipFrame(page)
      expect(noticeBox.x, 'the notice keeps its inset from the tool rail').toBeGreaterThanOrEqual(frame.left + CHROME_INSET_PX - 0.5)
      expect(noticeBox.x + noticeBox.width, 'the notice keeps its inset from the panel rail').toBeLessThanOrEqual(frame.right - CHROME_INSET_PX + 0.5)
      expect(noticeBox.width, 'the notice is no wider than its widest place').toBeLessThanOrEqual(NOTICE_MAX_WIDTH_PX + 0.5)
      expect(Math.abs(noticeBox.x + noticeBox.width / 2 - (frame.left + frame.right) / 2), 'the notice is centred in the visible map').toBeLessThanOrEqual(1)
    })

    test('with a panel open, the notice stands clear of the dock and Retry takes the click at its centre', async ({ page }) => {
      await openBaseFixture(page, { locale })
      await page.locator('[data-panel-rail] [data-panel]').first().click()
      const dock = page.locator('[data-key-region="dock"]')
      await expect(dock).toBeVisible()
      const { notice, retry } = await expectNoticeWithRetry(page)
      await expectRetryHit(retry)
      expect(overlap(await boxOf(notice), await boxOf(dock)), 'the notice clears the dock').toBe(false)
    })

    test('the selection chip and the chips\' visible map frame clear the notice', async ({ page }) => {
      await openBaseFixture(page, { locale })
      const { notice, retry } = await expectNoticeWithRetry(page)
      await selectAll(page)
      const selection = page.locator('[data-selection-chip]')
      await expect(selection).toBeVisible()
      await nextFrames(page)
      await expectRetryHit(retry)
      const noticeBox = await boxOf(notice)
      expect(overlap(noticeBox, await boxOf(selection)), 'the notice clears the selection chip').toBe(false)
      // The notice is bottom chrome on the visible-map-area seam wherever it shows: the chips avoid it.
      const frameBottom = (await chipFrame(page)).bottom
      expect(frameBottom, 'the chips\' visible map frame ends above the notice').toBeLessThanOrEqual(Math.ceil(noticeBox.y))
    })
  })
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 800, height: 700 }]) {
  test.describe(`${viewport.width}x${viewport.height} opening framing`, () => {
    test.use({ viewport })

    test('a Design opened while the notice shows is framed as one opened with the basemap hidden', async ({ page, context }) => {
      // input-probe.spec.ts and touch.spec.ts tap fixed places of the opening camera at 1024x768.
      // The basemap's style request is held, so "Loading basemap" shows while the Design opens and frames.
      const held: Array<{ fallback: () => Promise<void> }> = []
      await page.route('https://tiles.openfreemap.org/styles/**', (route) => { held.push(route) })
      await openBaseFixture(page)
      await expect(page.locator('[data-map-notice][data-tone="loading"]')).toBeVisible()
      await expect.poll(() => held.length, 'the style request is held').toBeGreaterThan(0)
      const zoomGroup = await boxOf(page.locator('[data-zoom-group]'))
      expect((await boxOf(page.locator('[data-map-notice]'))).y, 'the notice stands above the bottom row').toBeLessThan(zoomGroup.y)
      const withNotice = await openingFraming(page)
      // Released, the request reaches the offline rule, which aborts it: the notice turns to Retry, and the camera stays.
      for (const route of held) await route.fallback()
      await expectNoticeWithRetry(page)
      expect(await openingFraming(page), 'the notice turning to Retry leaves the camera where it was').toEqual(withNotice)
      // WebKit opens no file chooser from a page behind another: the second open runs alone.
      await page.close()

      const quiet = await context.newPage()
      await quiet.bringToFront()
      await openBaseFixture(quiet, { basemapHidden: true })
      await expect(quiet.locator('[data-zoom-group] button')).toHaveCount(ZOOM_GROUP_BUTTONS)
      await nextFrames(quiet)
      await expect(quiet.locator('[data-map-notice]')).toHaveCount(0)
      expect(withNotice, 'the camera the Design opens with').toEqual(await openingFraming(quiet))
    })
  })
}

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

/**
 * The zoom group's buttons once Show my location has joined it: zoom out, the scale, zoom in, Fit, Show my location and
 * the compass; the phone column has no scale.
 */
const ZOOM_GROUP_BUTTONS = 6
const PHONE_ZOOM_COLUMN_BUTTONS = 5

/** The Design map; locale-free (its name is translated). */
function mapHost(page: Page): Locator {
  return page.getByRole('application').first()
}

/**
 * Opens the base fixture in a fresh browser (the earlier open's draft would reopen with its camera), whose Web Edition
 * settings take `locale` and, with `basemapHidden`, hide the basemap so no notice shows.
 */
async function openBaseFixture(page: Page, { locale = 'en', basemapHidden = false } = {}): Promise<void> {
  await page.addInitScript((settings) => {
    localStorage.clear()
    localStorage.setItem(settings.key, JSON.stringify({ version: 2, settings: settings.values }))
  }, { key: SETTINGS_KEY, values: basemapHidden ? { locale, basemap_visible: false } : { locale } })
  await page.goto('')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-start-screen] button').filter({ hasText: /\.canopi/ }).first().click(),
  ])
  await chooser.setFiles(FIXTURE)
  await expect(mapHost(page)).toBeVisible()
  await expect(mapHost(page), 'the canvas has drawn the opened Design').not.toHaveAttribute('aria-busy')
}

async function expectNoticeWithRetry(page: Page): Promise<{ notice: Locator, retry: Locator }> {
  const notice = page.locator('[data-map-notice][data-tone="error"]')
  const retry = notice.getByRole('button')
  await expect(retry).toBeVisible()
  // The Zoom group, Show my location included, has laid out, and the seam has placed the chrome around it.
  const phone = await page.locator('[data-zoom-group="phone"]').count() > 0
  await expect(page.locator('[data-zoom-group] button')).toHaveCount(phone ? PHONE_ZOOM_COLUMN_BUTTONS : ZOOM_GROUP_BUTTONS)
  await nextFrames(page)
  return { notice, retry }
}

async function selectAll(page: Page): Promise<void> {
  await mapHost(page).focus()
  await pressMod(page, 'a')
  await expect(page.locator('[data-selection-chip]')).toBeVisible()
  await nextFrames(page)
}

/**
 * Where the camera opened the Design: the selection's rotate handle (above the middle of the whole Design's top edge,
 * from the camera's centre) and the map scale (its zoom). Selecting changes neither.
 */
async function openingFraming(page: Page): Promise<{ handle: { x: number, y: number }, scale: string | null }> {
  if (await page.locator('[data-selection-chip]').count() === 0) await selectAll(page)
  const handle = await boxOf(page.locator('[data-canvas-handle-glyph="rotate"]'))
  const scale = await page.locator('[data-zoom-group] button[aria-haspopup]').textContent()
  return { handle: { x: Math.round(handle.x * 4) / 4, y: Math.round(handle.y * 4) / 4 }, scale }
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
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

/** The lines the notice's sentence takes: one client rect per line box of its text. */
async function lineCount(notice: Locator): Promise<number> {
  return await notice.locator('[role="status"]').evaluate((status) => {
    const range = document.createRange()
    range.selectNodeContents(status)
    return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size
  })
}

/** The visible map frame the seam publishes on the map area for the chips (`--map-inset-*`), in page pixels. */
async function chipFrame(page: Page): Promise<{ top: number, right: number, bottom: number, left: number }> {
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
