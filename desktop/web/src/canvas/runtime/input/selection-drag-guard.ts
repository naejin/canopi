// canvas/runtime/input/selection-drag-guard.ts
//
// Adapted from GeoLibre packages/map/src/selection-drag-guard.ts at commit b3d91de.
// Copyright (c) 2026 Qiusheng Wu. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Keeps a page text selection out of a map drag (canopi-f47t.4). The map counts as part of a page-wide text selection:
// with one active, WebKit (the Tauri webview on Linux and macOS) treats a press on the map as a press on selected content
// and starts a native drag of the selection, and the pointer moves stop reaching the canvas. The guard collapses the
// selection when a primary press lands on the map, as a click on a plain page area does anyway, and cancels any native
// drag or new text selection that starts from the map, so a drag that runs off the map selects nothing beside it.
// Canopi's changes: it listens to `pointerdown` (the DOM source prevents a map press's pointerdown, which suppresses the
// compatibility `mousedown` GeoLibre listened to), it also cancels `selectstart`, and `keeps` leaves the note editor and
// the map's text fields their own selection and drags. The DOM source installs it on the map host while attached.

/** The part of `Selection` the guard needs. */
interface SelectionLike {
  readonly isCollapsed: boolean
  removeAllRanges(): void
}

/**
 * Installs the guard on the map host.
 *
 * @param container - The element wrapping the map.
 * @param keeps - True for a target that keeps the browser's own selection and drag (a text field in the map).
 * @param getSelection - Returns the active selection; defaults to the container document's. Injectable for tests.
 * @returns The removal of its listeners.
 */
export function installSelectionDragGuard(
  container: EventTarget & { ownerDocument?: Document | null },
  keeps: (target: EventTarget | null) => boolean,
  getSelection: () => SelectionLike | null = () => container.ownerDocument?.getSelection() ?? null,
): () => void {
  const onPointerDown = (event: Event): void => {
    if ((event as MouseEvent).button !== 0 || keeps(event.target)) return
    const selection = getSelection()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }
  const onDragStart = (event: Event): void => {
    if (keeps(event.target)) return
    // Honour an element that explicitly opted into HTML5 drag and drop (a custom marker); cancel the implicit canvas,
    // image or selection drag. The composed path reaches a draggable element inside an open shadow root, where
    // `event.target` is retargeted to the shadow host.
    for (const node of [event.target, ...(event.composedPath?.() ?? [])]) {
      if (node === container) break
      const element = node as { getAttribute?: (name: string) => string | null } | null
      // `draggable` is an enumerated attribute, matched ASCII case-insensitively.
      if (element?.getAttribute?.('draggable')?.toLowerCase() === 'true') return
    }
    event.preventDefault()
  }
  const onSelectStart = (event: Event): void => {
    if (!keeps(event.target)) event.preventDefault()
  }
  // Capture phase, so the selection is gone before the webview decides the press starts a drag, and so a descendant's
  // listener calling stopPropagation() cannot bypass the cancel.
  container.addEventListener('pointerdown', onPointerDown, { capture: true })
  container.addEventListener('dragstart', onDragStart, { capture: true })
  container.addEventListener('selectstart', onSelectStart, { capture: true })
  return () => {
    container.removeEventListener('pointerdown', onPointerDown, { capture: true })
    container.removeEventListener('dragstart', onDragStart, { capture: true })
    container.removeEventListener('selectstart', onSelectStart, { capture: true })
  }
}
