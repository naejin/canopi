// Help › Keyboard shortcuts (F1) lays out its rows in columns at least 300 px wide (KeyboardShortcutsDialog.module.css).
// A gesture row joins the platform's inputs into one key box, and the longest, French on a Mac whose browser delivers
// WebKit gesture events (Shift + right or middle drag, then the trackpad twist), is far wider than a column: the box
// wraps inside its section instead of running past it. jsdom has no layout, so this runs in the browser.
// No baselines: nothing here is compared with a recorded screenshot.
import { expect, test } from '../support/offline'

/** Safari on macOS: the shortcuts read the platform from the user agent (canvas/runtime/input/platform.ts). */
test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' })

test('every F1 key box stays inside its section in French on a Mac with trackpad gestures', async ({ page }) => {
  await page.addInitScript(() => {
    // The Web Edition's settings record (web/browser-app-data.ts), with French chosen.
    localStorage.setItem('canopi:web-app-data:v2:settings', JSON.stringify({ version: 2, settings: { locale: 'fr' } }))
    // WebKit's gesture events, which the twist row is shown for.
    const page = window as unknown as { GestureEvent?: unknown }
    page.GestureEvent ??= class GestureEvent extends UIEvent {}
  })
  await page.goto('')
  await expect(page.locator('[data-start-screen]')).toBeVisible()
  await page.keyboard.press('F1')
  const dialog = page.getByRole('dialog', { name: 'Raccourcis clavier' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Tourner deux doigts sur le pavé tactile', { exact: false })).toBeVisible()

  const outside = await dialog.locator('section').evaluateAll((sections) => sections.flatMap((section) => {
    const bounds = section.getBoundingClientRect()
    return Array.from(section.querySelectorAll('kbd'), (key) => {
      const box = key.getBoundingClientRect()
      return box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5 ? `${key.textContent} (${box.left}–${box.right} in ${bounds.left}–${bounds.right})` : null
    }).filter((entry) => entry !== null)
  }))
  expect(outside, 'key boxes that run past their section').toEqual([])
})
