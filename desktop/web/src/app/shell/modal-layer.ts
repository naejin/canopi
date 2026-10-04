import { computed, signal } from '@preact/signals'

/**
 * The one owner of modality. A modal dialog holds the layer while it is
 * mounted. While any hold is open, every registered chrome region (the title
 * bar, the rails, the workspace composition, app notices) is `inert`, so no
 * press, focus or menubar key reaches the UI behind the dialog, and
 * `modalLayerOpen` tells keyboard routes to stand aside.
 *
 * `inert` is set on the DOM synchronously, not through a render, so a closing
 * dialog that releases its hold can give focus back to the chrome that opened
 * it in the same task.
 */
const holds = signal(0)
const regions = new Set<HTMLElement>()

export const modalLayerOpen = computed(() => holds.value > 0)

function applyInert(open: boolean): void {
  for (const region of regions) region.toggleAttribute('inert', open)
}

/** Called by a modal dialog when it mounts; returns the release. */
export function holdModalLayer(): () => void {
  let released = false
  holds.value += 1
  if (holds.peek() === 1) applyInert(true)
  return () => {
    if (released) return
    released = true
    holds.value -= 1
    if (holds.peek() === 0) applyInert(false)
  }
}

/** Chrome that must be inert behind a modal dialog; returns its release. */
export function registerModalInertRegion(element: HTMLElement): () => void {
  regions.add(element)
  element.toggleAttribute('inert', holds.peek() > 0)
  return () => {
    if (!regions.delete(element)) return
    element.removeAttribute('inert')
  }
}
