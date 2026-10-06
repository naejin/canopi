// The note's text entry (canvas/runtime/chrome/text-entry-host.ts) sizes itself to what the browser measures: as wide as
// its text, or its placeholder while empty, and as tall as its lines. jsdom has no layout, so this runs in the browser,
// in both engines: two typed lines stay inside the box with the start of the text in view, for a new note and for a
// note edited in place while it is turned 30° on screen, and an empty field shows its whole placeholder in Russian and
// Japanese. No baselines: nothing here is compared with a recorded screenshot.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/offline'

const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-base.canopi', import.meta.url))
/** Empty map, away from every object and chrome of the fixture's opening camera. */
const NEUTRAL = { x: 800, y: 450 }

/** The map host, the one `application` on the page, by role alone: its name follows the page's language. */
function designMap(page: Page) {
  return page.getByRole('application')
}

async function openBaseFixture(page: Page, selectTool: string): Promise<void> {
  await page.goto('')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /\.canopi/ }).first().click(),
  ])
  await chooser.setFiles(FIXTURE)
  await expect(designMap(page)).toBeVisible()
  await expect(tool(page, selectTool)).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y)
  // The canvas has drawn the opened Design (e2e/support/canvas.ts).
  await expect(designMap(page)).not.toHaveAttribute('aria-busy')
}

/** A rail tool by its name in the page's language. */
function tool(page: Page, name: string) {
  return page.getByRole('toolbar').first().getByRole('button', { name, exact: true })
}

function entry(page: Page) {
  return page.locator('textarea[data-canvas-text-entry]')
}

/** Opens a new note's entry at the neutral point with the Text tool. */
async function openNewNote(page: Page, textTool: string): Promise<void> {
  await tool(page, textTool).click()
  await page.mouse.click(NEUTRAL.x, NEUTRAL.y)
  await expect(entry(page)).toBeFocused()
}

/** What the field shows of its content: its scroll extent against its box, and where it is scrolled to. */
async function fit(page: Page) {
  return entry(page).evaluate((field: HTMLTextAreaElement) => ({
    scrollWidth: field.scrollWidth,
    clientWidth: field.clientWidth,
    scrollHeight: field.scrollHeight,
    clientHeight: field.clientHeight,
    scrollLeft: field.scrollLeft,
    scrollTop: field.scrollTop,
    lineHeightPx: parseFloat(getComputedStyle(field).lineHeight),
    transform: field.style.transform,
  }))
}

async function expectTwoLinesInView(page: Page): Promise<void> {
  const box = await fit(page)
  expect(box.scrollWidth, 'the box is as wide as its longest line').toBeLessThanOrEqual(box.clientWidth)
  expect(box.scrollHeight, 'the box is as tall as its lines').toBeLessThanOrEqual(box.clientHeight)
  expect(box.clientHeight, 'the box holds both lines').toBeGreaterThanOrEqual(2 * box.lineHeightPx)
  expect([box.scrollLeft, box.scrollTop], 'the start of the text stays in view').toEqual([0, 0])
}

/** Types two lines, the second the longer, as Shift+Enter breaks a line. */
async function typeTwoLines(page: Page): Promise<void> {
  await page.keyboard.type('Gate to the')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('lower orchard and the pond')
}

test('a new note\'s two typed lines stay inside the entry, its start in view', async ({ page }) => {
  await openBaseFixture(page, 'Select')
  await openNewNote(page, 'Text note')
  await typeTwoLines(page)
  await expectTwoLinesInView(page)
})

test('a note edited in place while turned 30° on screen keeps its two lines inside the entry, its start in view', async ({ page }) => {
  await openBaseFixture(page, 'Select')
  // A new note stores the bearing: written at 30°, it is turned 30° once north is up again.
  await designMap(page).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await openNewNote(page, 'Text note')
  await page.keyboard.type('Gate')
  await page.keyboard.press('Enter')
  await expect(entry(page)).toHaveCount(0)
  await tool(page, 'Select').click()
  await designMap(page).focus()
  await page.keyboard.press('Shift+ArrowUp')

  // Enter under Select edits the one selected note: the new one.
  await page.keyboard.press('Enter')
  await expect(entry(page)).toBeFocused()
  expect((await fit(page)).transform).toBe('rotate(30deg)')
  await page.keyboard.press('End')
  await page.keyboard.type(' to the')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('lower orchard and the pond')
  await expectTwoLinesInView(page)
})

for (const { locale, selectTool, textTool, placeholder } of [
  { locale: 'ru', selectTool: 'Выделение', textTool: 'Текстовая заметка', placeholder: 'Введите заметку' },
  { locale: 'ja', selectTool: '選択', textTool: 'テキストメモ', placeholder: 'メモを入力' },
]) {
  test(`an empty note entry shows its whole placeholder in ${locale}`, async ({ page }) => {
    await page.addInitScript((chosen) => {
      // The Web Edition's settings record (web/browser-app-data.ts), with the language chosen.
      localStorage.setItem('canopi:web-app-data:v2:settings', JSON.stringify({ version: 2, settings: { locale: chosen } }))
    }, locale)
    await openBaseFixture(page, selectTool)
    await openNewNote(page, textTool)
    await expect(entry(page)).toHaveAttribute('placeholder', placeholder)
    // The placeholder's width in the field's own font and padding, measured beside it.
    const { needed, shown } = await entry(page).evaluate((field: HTMLTextAreaElement) => {
      const style = getComputedStyle(field)
      const mirror = document.createElement('span')
      mirror.textContent = field.placeholder
      Object.assign(mirror.style, {
        position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
        font: style.font, letterSpacing: style.letterSpacing,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
      })
      document.body.append(mirror)
      const width = mirror.getBoundingClientRect().width
      mirror.remove()
      return { needed: width, shown: field.clientWidth }
    })
    expect(needed, 'the whole placeholder fits the field').toBeLessThanOrEqual(shown + 0.5)
  })
}
