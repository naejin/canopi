// Phase 0 of canvas v2 (the refactor that must change nothing): steps 2-6 of the phase-0 live
// check (docs/plans/canvas-v2-plan.md section 4) on the base fixture, with real input in
// Chromium and WebKit, and 0E's viewport resize (its Web check), compared within the run.
// The baselines were recorded on the pre-0A commit in the pinned image:
// they are the phase-0 Web reference. Each step opens the fixture afresh, so a failure names
// the one step that broke; DOM reads say what broke, screenshots say what it looks like.
// Screenshots are taken on settled states only, never mid-drag (drafts are compared by eye)
// and never while a timer is still due to change the page (an open nudge series). Before each
// one the canvas has drawn the change the DOM checks saw (expectCanvasDrawn).
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { designMap, expectCanvasDrawn, pressMod } from '../support/canvas'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** Empty map, away from every object and chrome of the fixture's opening camera. */
const NEUTRAL = { x: 800, y: 450 }
/** A point on the left edge of the fixture's rectangle zone (14 m x 8 m) at the opening camera. */
const RECT_ZONE_EDGE = { x: 362, y: 300 }
const RECT_ZONE_CHIP = 'Rectangle zone · 112 m² · 44 m'
/** The Apple (Malus domestica) inside the rectangle zone, at the opening camera. */
const APPLE = { x: 425, y: 273 }

async function openBaseFixture(page: Page): Promise<void> {
  await page.goto('')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /Open a \.canopi file…/ }).first().click(),
  ])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
  // The opening camera frames the Design.
  await expect(scaleChip(page)).toHaveText('1:240')
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  await expectCanvasDrawn(page)
}

function tool(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
}

function scaleChip(page: Page) {
  return page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: /^Map scale/ })
}

function selection(page: Page) {
  return page.getByRole('group', { name: 'Selection' })
}

/**
 * Centres of the selected zone's control points, in page pixels. The overlay rebuilds its
 * handles on every refresh (a nudge series committing is one), so they are read in one pass
 * in the page: a handle read on its own could be one a refresh has just replaced.
 */
async function zoneCorners(page: Page): Promise<Array<{ x: number, y: number }>> {
  const corners = await page.getByRole('button', { name: /^Zone control point \d+$/ }).evaluateAll((handles) => handles.map((handle) => {
    const box = handle.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }))
  if (corners.length === 0) throw new Error('no zone is selected: no "Zone control point" is shown')
  return corners
}

async function firstCorner(page: Page): Promise<{ x: number, y: number }> {
  const [corner] = await zoneCorners(page)
  if (!corner) throw new Error('no zone control point')
  return corner
}

/**
 * Both engines lay boxes out in 1/64 px units, so a handle centre read from the DOM is off by
 * up to a few 1/64 px; 1/16 px stays far below the smallest step measured here (10 cm is
 * 1.57 px at the opening scale).
 */
const LAYOUT_TOLERANCE_PX = 1 / 16

function expectPx(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(3)} px, expected ${expected.toFixed(3)} px`).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX)
}

/**
 * A screenshot once two consecutive captures are identical, for comparing two states of one
 * run with each other (toHaveScreenshot compares with the baseline instead).
 */
async function settledScreenshot(page: Page): Promise<Buffer> {
  let previous = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(100)
    const next = await page.screenshot({ animations: 'disabled', caret: 'hide' })
    if (next.equals(previous)) return next
    previous = next
  }
  throw new Error('the page never settled: consecutive screenshots kept changing for 3 s')
}

test('step 2: the wheel zooms, and zooming back restores the opening pixels', async ({ page }) => {
  await openBaseFixture(page)
  await expect(page).toHaveScreenshot('phase0-02a-opening.png')
  const opening = await settledScreenshot(page)

  await page.mouse.wheel(0, -300)
  await expect(scaleChip(page), 'wheel up changes the scale').not.toHaveText('1:240')
  const zoomed = Number((await scaleChip(page).textContent())?.replace(/^1:/, '').replace(/[^\d]/g, ''))
  expect(zoomed, 'wheel up zooms in (a smaller scale denominator)').toBeLessThan(240)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-02b-zoomed.png')

  await page.mouse.wheel(0, 300)
  await expect(scaleChip(page), 'the opposite wheel returns to the opening scale').toHaveText('1:240')
  const back = await settledScreenshot(page)
  if (!back.equals(opening)) {
    await test.info().attach('opening', { body: opening, contentType: 'image/png' })
    await test.info().attach('back', { body: back, contentType: 'image/png' })
  }
  expect(back.equals(opening), 'zooming back gives the opening pixels').toBe(true)
})

test('step 3: Space and a 200 px left drag pan the map 200 px; objects stay on their ground', async ({ page }) => {
  await openBaseFixture(page)
  // The zone's corner handle is the DOM's measure of where the zone is drawn.
  await page.mouse.click(RECT_ZONE_EDGE.x, RECT_ZONE_EDGE.y)
  await expect(selection(page).getByRole('status')).toHaveText(RECT_ZONE_CHIP)
  const before = await firstCorner(page)
  await page.keyboard.press('Escape')
  await expect(selection(page), 'Esc in Select clears the selection').toHaveCount(0)

  await page.keyboard.down('Space')
  await page.mouse.move(500, 620)
  await page.mouse.down()
  await page.mouse.move(700, 620, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  await expect(scaleChip(page), 'a pan keeps the scale').toHaveText('1:240')
  await expect(tool(page, 'Undo'), 'panning never edits the Design').toBeDisabled()
  await expect(selection(page), 'Space-drag pans; it does not marquee-select').toHaveCount(0)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-03-space-pan.png')

  await page.mouse.click(RECT_ZONE_EDGE.x + 200, RECT_ZONE_EDGE.y)
  await expect(selection(page).getByRole('status'), 'the zone edge is now 200 px right').toHaveText(RECT_ZONE_CHIP)
  const after = await firstCorner(page)
  expectPx(after.x - before.x, 200, 'the zone moved with the map, 200 px right')
  expectPx(after.y - before.y, 0, 'a horizontal drag does not move the map vertically')
})

test('step 4: right-click on a plant opens the canvas menu with today\'s entries; Esc closes it', async ({ page }) => {
  await openBaseFixture(page)
  await page.mouse.click(APPLE.x, APPLE.y, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Apple' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^Cut/, /^Copy/, /^Paste/, /^Duplicate/,
    /^Select all of this species/, /^Plant color/, /^Plant symbol/, /^Show name/, /^Species details/,
    /^Add to calendar…/, /^Set unit cost…/,
    /^Arrange/, /^Rotate…/,
    /^Lock/, /^Unlock/,
    /^Delete/,
  ])
  await expect(selection(page).getByRole('status'), 'the right-click selects the plant').toHaveText('Apple')
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-04a-context-menu.png')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu'), 'Esc closes the canvas menu').toHaveCount(0)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-04b-menu-closed.png')
})

test('step 5: P places a plant, Ctrl+Z removes it; R draws a rectangle; Esc, Esc returns to Select and clears', async ({ page }) => {
  await openBaseFixture(page)
  await page.mouse.click(NEUTRAL.x, NEUTRAL.y)
  await page.keyboard.press('p')
  await expect(tool(page, 'Place plants')).toHaveAttribute('aria-pressed', 'true')
  // The Design's own species: the Web plant catalog is not part of the job's build.
  await page.getByRole('region', { name: 'In this Design' }).getByRole('button', { name: 'Apple Malus domestica' }).click()
  await expect(page.getByRole('region', { name: 'Place plants' }).getByRole('status')).toContainText('Apple')

  await page.mouse.click(680, 420)
  await expect(tool(page, 'Undo'), 'placing a plant is one Design edit').toBeEnabled()
  await expect(selection(page).getByRole('status'), 'the placed plant is selected').toHaveText('Apple')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-05a-plant-placed.png')

  await pressMod(page, 'z')
  await expect(tool(page, 'Undo'), 'Ctrl+Z undid the only edit').toBeDisabled()
  await expect(tool(page, 'Redo')).toBeEnabled()
  await expect(selection(page), 'the removed plant is no longer selected').toHaveCount(0)
  await expect(tool(page, 'Place plants'), 'undo keeps the tool').toHaveAttribute('aria-pressed', 'true')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-05b-plant-undone.png')

  await page.keyboard.press('r')
  await expect(tool(page, 'Rectangle zone')).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(360, 440)
  await page.mouse.down()
  await page.mouse.move(620, 640, { steps: 10 })
  await page.mouse.up()
  await expect(selection(page).getByRole('status'), 'the drawn rectangle is selected').toHaveText('Rectangle zone · 192 m² · 56 m')
  await expect(tool(page, 'Rectangle zone'), 'the tool stays armed after a rectangle').toHaveAttribute('aria-pressed', 'true')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-05c-rect-drawn.png')

  await page.keyboard.press('Escape')
  await expect(tool(page, 'Select'), 'the first Esc returns to Select').toHaveAttribute('aria-pressed', 'true')
  await expect(selection(page).getByRole('status'), 'the first Esc keeps the selection').toHaveText('Rectangle zone · 192 m² · 56 m')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-05d-esc-select.png')

  await page.keyboard.press('Escape')
  await expect(selection(page), 'the second Esc clears the selection').toHaveCount(0)
  await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-05e-esc-cleared.png')
})

test('step 6: ArrowRight nudges a selected zone 10 cm east, Control+ArrowRight 1 m; each pause commits one Design edit', async ({ page }) => {
  await openBaseFixture(page)
  await page.mouse.click(RECT_ZONE_EDGE.x, RECT_ZONE_EDGE.y)
  await expect(selection(page).getByRole('status')).toHaveText(RECT_ZONE_CHIP)
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  const start = await zoneCorners(page)
  const [c1, c2, , c4] = start
  if (!c1 || !c2 || !c4) throw new Error('the rectangle zone shows fewer than four control points')
  // Pixels per metre from the zone itself: its handles span 14 m x 8 m (112 m², the chip).
  const pxPerMetre = Math.sqrt(Math.abs((c2.x - c1.x) * (c4.y - c1.y)) / 112)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-06a-zone-selected.png')

  // Arrow keys open a nudge series: the zone moves at once, Undo stays off while the series is
  // open, and the series commits as one Design edit once the keys pause. Each step waits for
  // that commit (a condition, not the pause's length) before measuring and taking a screenshot,
  // so the next key starts a series of its own.
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await firstCorner(page)).x - c1.x, 'ArrowRight moves the zone').toBeGreaterThan(LAYOUT_TOLERANCE_PX)
  await expect(tool(page, 'Undo'), 'the ArrowRight series commits as one Design edit after its pause').toBeEnabled()
  const nudged = await firstCorner(page)
  // Today's world axes: the camera is north-up, so east is +x on screen and y does not change.
  expectPx(nudged.x - c1.x, 0.1 * pxPerMetre, 'ArrowRight moves the zone 10 cm east')
  expectPx(nudged.y - c1.y, 0, 'ArrowRight does not move the zone north or south')
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-06b-nudge-10cm.png')

  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await firstCorner(page)).x - nudged.x, 'Control+ArrowRight moves the zone').toBeGreaterThan(LAYOUT_TOLERANCE_PX)
  await expect(tool(page, 'Undo'), 'the Control+ArrowRight series commits as one Design edit after its pause').toBeEnabled()
  const large = await firstCorner(page)
  expectPx(large.x - nudged.x, pxPerMetre, 'Control+ArrowRight moves the zone 1 m east')
  expectPx(large.y - nudged.y, 0, 'Control+ArrowRight does not move the zone north or south')
  await expect(selection(page).getByRole('status'), 'nudging keeps the zone selected').toHaveText(RECT_ZONE_CHIP)
  await expectCanvasDrawn(page)
  await expect(page).toHaveScreenshot('phase0-06c-nudge-1m.png')

  await pressMod(page, 'z')
  await expect.poll(async () => (await firstCorner(page)).x - shifted.x, 'Ctrl+Z moves the zone back').toBeLessThan(-LAYOUT_TOLERANCE_PX)
  const undone = await firstCorner(page)
  expectPx(undone.x - nudged.x, 0, 'Ctrl+Z undoes the 1 m series alone: the zone is back 10 cm east of its start')
  expectPx(undone.y - nudged.y, 0, 'Ctrl+Z does not move the zone north or south')
  await expect(tool(page, 'Undo'), 'the 10 cm series is still an edit to undo').toBeEnabled()
  await expect(tool(page, 'Redo'), 'the 1 m series can be redone').toBeEnabled()
})

/** The centre of the map host, in page pixels: a resize keeps the camera's centre there (0E, D8). */
async function mapCentre(page: Page): Promise<{ x: number, y: number, width: number, height: number }> {
  const box = await designMap(page).boundingBox()
  if (!box) throw new Error('the Design map has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height }
}

test('canvas v2 0E: a viewport resize keeps the map and the Design on their ground; resizing back restores the pixels', async ({ page }) => {
  await openBaseFixture(page)
  // The selected zone's handles are the DOM's measure of where the Design is drawn.
  await page.mouse.click(RECT_ZONE_EDGE.x, RECT_ZONE_EDGE.y)
  await expect(selection(page).getByRole('status')).toHaveText(RECT_ZONE_CHIP)
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  await expectCanvasDrawn(page)
  const before = await settledScreenshot(page)
  const centre = await mapCentre(page)
  const offsets = (await zoneCorners(page)).map(({ x, y }) => ({ x: x - centre.x, y: y - centre.y }))

  await page.setViewportSize({ width: 1300, height: 840 })
  await expect.poll(async () => (await mapCentre(page)).width, 'the map host shrinks with the window').toBeLessThan(centre.width)
  const resized = await mapCentre(page)
  // The camera keeps its centre and scale (D8), so each handle keeps its offset from the map's centre.
  await expect.poll(async () => {
    const corners = await zoneCorners(page)
    return Math.max(...corners.map(({ x, y }, index) => Math.max(
      Math.abs(x - resized.x - offsets[index]!.x),
      Math.abs(y - resized.y - offsets[index]!.y),
    )))
  }, 'the zone keeps its place relative to the map centre').toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX)
  await expect(scaleChip(page), 'a resize keeps the scale').toHaveText('1:240')
  await expect(tool(page, 'Undo'), 'a resize never edits the Design').toBeDisabled()

  await page.setViewportSize({ width: 1400, height: 900 })
  await expect.poll(async () => (await mapCentre(page)).width, 'the map host returns to its size').toBe(centre.width)
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  await expectCanvasDrawn(page)
  const back = await settledScreenshot(page)
  if (!back.equals(before)) {
    await test.info().attach('before', { body: before, contentType: 'image/png' })
    await test.info().attach('back', { body: back, contentType: 'image/png' })
  }
  expect(back.equals(before), 'resizing back gives the pixels before the resize: the map and the Design kept their ground').toBe(true)
})
