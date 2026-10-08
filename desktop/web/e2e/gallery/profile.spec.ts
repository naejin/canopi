// The Site data profile in real engines (canopi-f47t.42, plan section 4, stream D, g5): Profile from the Site data
// toolbar, three clicks and a double-click finish a line and arm Select; the chart draws one path per curve, hovering
// says where, Steepest moves the cursor, × ends the profile;
// Copy values writes tab-separated text in the locale's decimals (the gallery's clipboard stub reads it back); and
// "Profile this line" on a Line zone's canvas menu draws that line's profile (U49 Q29). The memory backend samples its
// analytic site, which covers the west of the fixture Design. The gallery runs no canvas key router, so Enter, Backspace
// and the Esc order are checked through the real key path in jsdom (canvas-interaction-e2e.profile.test.ts). DOM
// assertions only, no baselines.
//
// Stream D's probe, first: the two platform assumptions the profile is built on.
// - Copy values builds its text in the click handler and calls `navigator.clipboard.writeText` there, inside the user
//   activation, with no clipboard plugin. In Chromium the real clipboard is restored over the gallery's stub, the
//   permission granted, and the text read back. Tauri WebKitGTK (X11 and Wayland) is the live check n4.
// - The chart's hover moves a ring on the map with one GeoJSON `setData` per event (GeoLibre `NativeProfileMap.setHover`),
//   never the overlay snapshot. A 2 s sweep at 60 events/s records the page's rAF deltas at bearings 0° and 37° beside an
//   idle baseline, on a real MapLibre map through the app's own loader; each test records them as annotations.
//   WebKitGTK, the engine the decision rests on, is measured in the live check n4.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { copiedTexts, expect, openGallery, test } from '../support/gallery'

const LOADER = fileURLToPath(new URL('../../src/maplibre/loader.ts', import.meta.url))

interface FrameStats { readonly events: number, readonly frames: number, readonly p50: number, readonly p95: number, readonly max: number, readonly over33: number }

/**
 * How a 2 s sweep moves the hover: 'idle' sends nothing (the baseline), 'repaint' only asks MapLibre for a frame per
 * event (what any map-drawn marker costs), 'setData' moves the ring with one GeoJSON setData per event (the design),
 * 'marker' moves a DOM element over the map instead (the design's fallback).
 */
type SweepMode = 'idle' | 'repaint' | 'setData' | 'marker'

/**
 * Mounts a real MapLibre map (the app's loader, its worker) over the gallery, with a hover source and a hollow ring
 * as the Site data hover draws it, at `bearing`; then records 2 s of rAF deltas while `mode` moves the hover along a
 * line at 60 events/s.
 */
async function sweepFrames(page: Page, bearing: number, mode: SweepMode): Promise<FrameStats> {
  return page.evaluate(async ({ loader, bearing, mode }) => {
    const { loadMapLibreModule } = await import(/* @vite-ignore */ `/@fs${loader}`) as {
      loadMapLibreModule(): Promise<{ Map: new (options: unknown) => unknown }>
    }
    const maplibre = await loadMapLibreModule()
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647'
    document.body.appendChild(container)
    const map = new maplibre.Map({
      container,
      style: { version: 8, sources: {}, layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#e8e2d4' } }] },
      center: [2.3522, 48.8566],
      zoom: 17,
      bearing,
      attributionControl: false,
    }) as {
      on(event: string, listener: () => void): void
      addSource(id: string, source: unknown): void
      addLayer(layer: unknown): void
      getSource(id: string): { setData(data: unknown): void }
      project(lngLat: [number, number]): { x: number, y: number }
      triggerRepaint(): void
      remove(): void
    }
    await new Promise<void>((resolve) => map.on('load', () => resolve()))
    const empty = { type: 'FeatureCollection', features: [] }
    map.addSource('probe-hover', { type: 'geojson', data: empty })
    map.addLayer({
      id: 'probe-hover-ring', type: 'circle', source: 'probe-hover',
      paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': '#27231D' },
    })
    const source = map.getSource('probe-hover')
    const ring = document.createElement('div')
    ring.style.cssText = 'position:absolute;left:0;top:0;width:12px;height:12px;margin:-6px;border:2px solid #27231D;border-radius:50%'
    container.appendChild(ring)
    const deltas: number[] = []
    let last = performance.now()
    let running = true
    const frame = (now: number) => {
      deltas.push(now - last)
      last = now
      if (running) requestAnimationFrame(frame)
    }
    requestAnimationFrame((now) => { last = now; requestAnimationFrame(frame) })
    const start = performance.now()
    let events = 0
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = (performance.now() - start) / 2000
        if (t >= 1) {
          clearInterval(timer)
          resolve()
          return
        }
        if (mode === 'idle') return
        events += 1
        const at: [number, number] = [2.3512 + 0.002 * t, 48.8566]
        if (mode === 'repaint') map.triggerRepaint()
        if (mode === 'setData') {
          source.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }] })
        }
        if (mode === 'marker') {
          const { x, y } = map.project(at)
          ring.style.transform = `translate(${x}px, ${y}px)`
        }
      }, 1000 / 60)
    })
    running = false
    map.remove()
    container.remove()
    const sorted = deltas.slice(1).sort((a, b) => a - b)
    const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10
    return {
      events,
      frames: sorted.length,
      p50: at(0.5),
      p95: at(0.95),
      max: Math.round(sorted[sorted.length - 1]! * 10) / 10,
      over33: sorted.filter((delta) => delta > 33.4).length,
    }
  }, { loader: LOADER, bearing, mode })
}

test.describe('Profile: stream D probe', () => {
  test('Copy values: writeText from a synchronous click reaches the real clipboard (Chromium, granted)', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit has no clipboard permission grant; Tauri WebKitGTK is the live check n4')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openGallery(page, { surface: 'site-data' })
    const text = 'Distance (m)\tLongitude\tLatitude\n0\t2.3522000\t48.8566000\n'
    await page.evaluate((text) => {
      // The gallery stubs the clipboard as an own property; deleting it restores the engine's.
      delete (navigator as { clipboard?: unknown }).clipboard
      const button = document.createElement('button')
      button.textContent = 'Probe copy'
      button.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647'
      button.addEventListener('click', () => {
        // Built and written in the handler, as Copy values does.
        navigator.clipboard.writeText(text).then(
          () => { button.dataset.copied = 'ok' },
          (error: unknown) => { button.dataset.copied = `failed: ${String(error)}` },
        )
      })
      document.body.appendChild(button)
    }, text)
    const button = page.getByRole('button', { name: 'Probe copy' })
    await button.click()
    await expect(button).toHaveAttribute('data-copied', 'ok')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  })

  test('the chart hover: rAF deltas over 2 s at 60 events/s at bearings 0 and 37, setData against a repaint and a DOM ring', async ({ page, browserName }) => {
    await openGallery(page, { surface: 'site-data' })
    const describe = (stats: FrameStats) =>
      `${stats.events} events, p50 ${stats.p50} p95 ${stats.p95} max ${stats.max}, over 33 ms ${stats.over33}/${stats.frames}`
    for (const bearing of [0, 37]) {
      const runs = {} as Record<SweepMode, FrameStats>
      for (const mode of ['idle', 'repaint', 'setData', 'marker'] as const) runs[mode] = await sweepFrames(page, bearing, mode)
      for (const mode of ['idle', 'repaint', 'setData', 'marker'] as const) {
        test.info().annotations.push({ type: `rAF ms, ${browserName}, bearing ${bearing}, ${mode}`, description: describe(runs[mode]) })
      }
      // setData adds nothing of its own to the map's repaint: its median frame stays within twice a bare repaint's (the
      // engines' software GL makes every repaint slow, and both are noisy, so this only catches a setData-made stall).
      expect(runs.setData.p50, `bearing ${bearing}: setData p50 against repaint p50 ${runs.repaint.p50}`)
        .toBeLessThanOrEqual(2 * runs.repaint.p50 + 17)
    }
  })
})

/**
 * The map, and a point at a fraction of its box. The tool rail covers its left sixth and Site data its right third, so
 * lines run from 22 % to 60 % of the width, across the planting and the analytic site west of it.
 */
async function mapPoints(page: Page, name = 'Design map'): Promise<{ map: Locator, at: (fx: number, fy?: number) => { x: number, y: number } }> {
  const map = page.getByRole('application', { name })
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  return { map, at: (fx, fy = 0.5) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }) }
}

/** Past the recogniser's 500 ms multi-click window, so each point is a first click. */
const PAST_MULTI_CLICK_MS = 600

function tool(page: Page, name: string): Locator {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: new RegExp(`^${name}( \\(.\\))?$`) })
}

function siteData(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Site data' })
}

function chart(page: Page): Locator {
  return siteData(page).getByRole('region', { name: 'Profile' })
}

/** Arms Profile from the Site data toolbar and clicks `points` in turn, the last one twice (a double-click). */
async function drawProfile(page: Page, points: readonly { x: number, y: number }[]): Promise<void> {
  await siteData(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(page.getByText('Click to add points. Double-click or press Enter to finish.')).toBeVisible()
  for (const point of points.slice(0, -1)) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(PAST_MULTI_CLICK_MS)
  }
  const last = points[points.length - 1]!
  await page.mouse.dblclick(last.x, last.y)
}

test.describe('Profile (g5)', () => {
  test('three clicks and a double-click draw a profile and arm Select; hovering says where, Steepest moves the cursor', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const { at } = await mapPoints(page)

    await drawProfile(page, [at(0.22), at(0.4, 0.45), at(0.6)])

    await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
    const profile = chart(page)
    await expect(profile.getByRole('heading', { name: 'Profile' })).toBeVisible()
    const legend = profile.getByRole('listitem')
    await expect(legend.first()).toContainText('IGN ground elevation')
    // One path per curve.
    await expect(profile.locator(':scope > svg path')).toHaveCount(await legend.count())
    await expect(legend.first()).toContainText(/Rise [+−-]?\d/)

    const plot = await profile.locator(':scope > svg').boundingBox()
    if (!plot) throw new Error('no plot')
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.3)
    await expect(profile.getByText(/^At \d/)).toBeVisible()
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y - 40)
    await expect(profile.getByText(/^At \d/)).toHaveCount(0)

    await profile.getByRole('button', { name: /^Steepest / }).first().click()
    await expect(profile.getByText(/^At \d/)).toBeVisible()

    await profile.getByRole('button', { name: 'Close profile' }).click()
    await expect(chart(page)).toHaveCount(0)
  })

  test('Copy values copies tab-separated text in the locale\'s decimals', async ({ page }) => {
    await openGallery(page, { surface: 'site-data', locale: 'fr' })
    const { at } = await mapPoints(page, 'Carte du Design')
    const panel = page.locator('aside').filter({ has: page.getByRole('button', { name: 'Profil', exact: true }) })
    await panel.getByRole('button', { name: 'Profil', exact: true }).click()
    await page.mouse.click(at(0.22).x, at(0.22).y)
    await page.waitForTimeout(PAST_MULTI_CLICK_MS)
    await page.mouse.dblclick(at(0.6).x, at(0.6).y)

    await panel.getByRole('button', { name: 'Copier les valeurs' }).click()
    await expect(panel.getByText('Copié')).toBeVisible()
    const [text] = (await copiedTexts(page)).slice(-1)
    const lines = text!.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^Distance \(m\)\tLongitude\tLatitude\tIGN ground elevation \(m\)/)
    const first = lines[1]!.split('\t')
    expect(first[0]).toBe('0,00')
    expect(first[1]).toMatch(/^\d+,\d{7}$/)
    expect(first[2]).toMatch(/^\d+,\d{7}$/)
    expect(lines.slice(1).some((line) => /\t\d+,\d{2}(\t|$)/.test(line)), 'some value in the locale\'s decimals').toBe(true)
  })

  test('Profile this line on a Line zone\'s menu draws that line\'s profile', async ({ page }) => {
    await openGallery(page, { surface: 'site-data' })
    const { at } = await mapPoints(page)
    // Without snapping the line lies exactly where it was dragged, so the right-click finds it.
    const snap = page.getByRole('button', { name: 'Snap to grid' })
    await snap.click()
    await expect(snap).toHaveAttribute('aria-pressed', 'false')
    await tool(page, 'Line zone').click()
    const [from, to] = [at(0.22, 0.62), at(0.6, 0.62)]
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await expect(chart(page)).toHaveCount(0)

    // With Select armed, a right-click on the line (off the length chip at its middle) opens its menu.
    await tool(page, 'Select').click()
    await page.mouse.click(at(0.3, 0.62).x, at(0.3, 0.62).y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Profile this line' }).click()

    await expect(chart(page).getByRole('listitem').first()).toContainText('IGN ground elevation')
  })
})
