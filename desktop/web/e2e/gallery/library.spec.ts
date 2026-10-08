// The Data library sheet (canopi-f47t.42, plan section 4, gallery g6; pattern site-data.md "Dialogs and library").
// A large sheet of fixed height over the dimmed workspace: the item list and the selected item's details scroll on
// their own, the footer stays inside the sheet, and below 760 px one pane shows at a time with Back. Run in Chromium
// and WebKit (projects gallery-chromium and gallery-webkit); DOM assertions only, no baselines.
import type { Locator, Page } from '@playwright/test'
import { expect, openGallery, test } from '../support/gallery'

/** playwright.config.ts's window; the sheet is min(1200 px, 100vw − 48) × min(860 px, 100vh − 48). */
const WIDE = { width: 1400, height: 900 }
/** A window whose sheet is narrower than 760 px. */
const NARROW = { width: 740, height: 820 }

function sheet(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Data library' })
}

function itemList(page: Page): Locator {
  return sheet(page).getByRole('listbox')
}

/** The selected item's details: the one region of the sheet, named by the item. */
function detailsPane(page: Page): Locator {
  return sheet(page).getByRole('region')
}

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  if (!value) throw new Error('no box')
  return value
}

async function scrollTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.scrollTop)
}

test.describe('the Data library sheet', () => {
  test('forty items: the list and the details scroll on their own, and the footer stays in the sheet', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openGallery(page, { surface: 'library', state: 'long' })
    const dialog = sheet(page)
    await expect(itemList(page).getByRole('option')).toHaveCount(40)
    const sheetBox = await box(dialog)
    expect(sheetBox.width).toBeCloseTo(1200, 0)
    expect(sheetBox.height).toBeCloseTo(Math.min(860, WIDE.height - 48), 0)

    const list = itemList(page)
    const details = detailsPane(page)
    await expect(details).toBeVisible()
    const listMetrics = await list.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }))
    expect(listMetrics.scroll, 'forty rows overflow the list pane').toBeGreaterThan(listMetrics.client)

    const footer = dialog.locator('footer')
    const footerBefore = await box(footer)
    expect(footerBefore.y + footerBefore.height, 'the footer ends inside the sheet').toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 0.5)
    expect(footerBefore.y).toBeGreaterThan(sheetBox.y)

    const listBox = await box(list)
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2)
    await page.mouse.wheel(0, 2400)
    await expect.poll(() => scrollTop(list), { message: 'the list scrolls' }).toBeGreaterThan(0)
    expect(await scrollTop(details), 'the details pane did not move').toBe(0)
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0), 'the page did not move').toBe(0)
    expect(await box(footer), 'the footer did not move').toEqual(footerBefore)
    expect(await box(dialog), 'the sheet did not grow').toEqual(sheetBox)
    // The last row can be reached.
    await expect(list.getByRole('option').last()).toBeInViewport()

    // The details pane scrolls without moving the list.
    const listScrolled = await scrollTop(list)
    const detailsBox = await box(details)
    const detailMetrics = await details.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }))
    if (detailMetrics.scroll > detailMetrics.client) {
      await page.mouse.move(detailsBox.x + detailsBox.width / 2, detailsBox.y + detailsBox.height / 2)
      await page.mouse.wheel(0, 1200)
      await expect.poll(() => scrollTop(details), { message: 'the details scroll' }).toBeGreaterThan(0)
      expect(await scrollTop(list), 'the list did not move').toBe(listScrolled)
    }
    expect(await details.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto')
  })

  test('below 760 px one pane shows at a time, with Back', async ({ page }) => {
    await page.setViewportSize(NARROW)
    await openGallery(page, { surface: 'library', state: 'long' })
    const list = itemList(page)
    await expect(list).toBeVisible()
    await expect(detailsPane(page)).toBeHidden()
    const sheetBox = await box(sheet(page))
    expect(sheetBox.width).toBeLessThan(760)
    const footer = sheet(page).locator('footer')
    expect((await box(footer)).y + (await box(footer)).height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 0.5)

    await list.getByRole('option', { name: /^IGN LiDAR HD MNT tile 0470_6805/ }).click()
    await expect(list).toBeHidden()
    const details = sheet(page).getByRole('region', { name: 'IGN LiDAR HD MNT tile 0470_6805' })
    await expect(details).toBeVisible()
    await sheet(page).getByRole('button', { name: 'Back' }).click()
    await expect(details).toBeHidden()
    await expect(list).toBeVisible()
  })
})
