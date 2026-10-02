// Readiness of the canvas for the Web Edition browser checks. The DOM (chips, pressed tools,
// Undo) changes as soon as the Design does; the canvas draws it a frame and an asynchronous
// render step later. The runtime marks the Design map aria-busy from a Design change until
// its renderer has drawn it (canvas/runtime/scene-runtime.ts), and never for a camera frame:
// a step that flies the camera emulates reduced motion first, so the camera jumps instead
// (page.emulateMedia({ reducedMotion: 'reduce' }), as base.spec.ts does to present a story).
import type { Page } from '@playwright/test'
import { expect } from './offline'

/** The map host: the keyboard stop the canvas draws in. */
export function designMap(page: Page) {
  return page.getByRole('application', { name: 'Design map' })
}

/**
 * Waits until the canvas has drawn the latest Design edit, undo, selection or opened Design.
 * Call it before a screenshot, after the DOM checks that say the change happened.
 */
export async function expectCanvasDrawn(page: Page): Promise<void> {
  await expect(designMap(page), 'the canvas has drawn the latest change').not.toHaveAttribute('aria-busy')
}

/**
 * Presses a `mod` shortcut as the page's own platform spells it: Cmd where the user agent names a Mac, Ctrl elsewhere
 * (app/keyboard/key-chord.ts; a physical Ctrl on a Mac is `ctrl`, never `mod`). Playwright's WebKit reports a Mac
 * user agent on every host, and its `ControlOrMeta` follows the host, not the page.
 */
export async function pressMod(page: Page, key: string): Promise<void> {
  const mac = await page.evaluate(() => /Macintosh|Mac OS X|iPhone|iPad/.test(navigator.userAgent))
  await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+${key}`)
}
