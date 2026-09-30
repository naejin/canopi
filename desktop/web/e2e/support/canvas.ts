// Readiness of the canvas for the Web Edition browser checks. The DOM (chips, pressed tools,
// Undo) changes as soon as the Design does; the canvas draws it a frame and an asynchronous
// render step later. The runtime marks the Design map aria-busy from a Design change until
// its renderer has drawn it (canvas/runtime/scene-runtime.ts), and never for a camera frame.
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
