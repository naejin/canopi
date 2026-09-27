export interface FloatingPositionOptions {
  gap?: number
  viewportPad?: number
  minUsable?: number
  preferred?: 'up' | 'down'
}

export interface FloatingPositionResult {
  direction: 'up' | 'down'
  availableHeight: number
}

/**
 * Compute the best vertical direction for a floating element relative to its
 * trigger, plus the available height in that direction. Flips when the
 * preferred direction has less than `minUsable` px and the opposite has more.
 */
export function computeFloatingDirection(
  triggerRect: DOMRect,
  options?: FloatingPositionOptions,
): FloatingPositionResult {
  const gap = options?.gap ?? 8
  const pad = options?.viewportPad ?? 8
  const minUsable = options?.minUsable ?? 100
  const preferred = options?.preferred ?? 'down'

  const spaceBelow = window.innerHeight - triggerRect.bottom - gap - pad
  const spaceAbove = triggerRect.top - gap - pad

  let direction: 'up' | 'down' = preferred
  if (preferred === 'up') {
    if (spaceAbove < minUsable && spaceBelow > spaceAbove) direction = 'down'
  } else {
    if (spaceBelow < minUsable && spaceAbove > spaceBelow) direction = 'up'
  }

  const available = direction === 'down' ? spaceBelow : spaceAbove
  return { direction, availableHeight: Math.max(available, 80) }
}

/**
 * Check if a floating element anchored at triggerRect.left would overflow
 * the right edge of the viewport. Uses an estimated floating width for
 * synchronous pre-render check.
 */
export function shouldAlignRight(
  triggerRect: DOMRect,
  estimatedWidth: number,
  viewportPad?: number,
): boolean {
  const pad = viewportPad ?? 8
  return triggerRect.left + estimatedWidth > window.innerWidth - pad
}

export interface PopupVerticalPlacement {
  /** Viewport top of the popup, in CSS pixels. */
  readonly top: number
  /** Height cap so the popup fits the viewport; the popup scrolls inside it. */
  readonly maxHeight: number
  readonly direction: 'up' | 'down'
}

/**
 * Places a popup of `height` below its anchor, or above it when only that side
 * fits it. When neither side fits, the roomier side wins and the popup's height
 * is capped to that room, so it never covers its anchor or leaves the viewport.
 *
 * `slide` is for a popup that opens beside a pointer rather than over it (a
 * context menu to the right or left of the pointer): when neither side fits,
 * it moves up just enough to end inside the viewport, capped to the viewport,
 * so it shows whole instead of scrolling.
 */
export function placePopupVertically(
  anchor: { readonly top: number; readonly bottom: number },
  height: number,
  viewportHeight: number,
  { gap = 4, margin = 8, slide = false }: { readonly gap?: number; readonly margin?: number; readonly slide?: boolean } = {},
): PopupVerticalPlacement {
  const below = Math.max(0, viewportHeight - margin - anchor.bottom - gap)
  const above = Math.max(0, anchor.top - gap - margin)
  if (slide && height > below && height > above) {
    const beside = placeSidePopupVertically(anchor.bottom + gap, height, viewportHeight, { margin })
    return { direction: 'down', ...beside }
  }
  const direction: 'up' | 'down' = height <= below || below >= above ? 'down' : 'up'
  const maxHeight = direction === 'down' ? below : above
  const shown = Math.min(height, maxHeight)
  return {
    direction,
    maxHeight,
    top: direction === 'down' ? anchor.bottom + gap : anchor.top - gap - shown,
  }
}

/**
 * Places a submenu beside its parent item: level with the item, moved up only
 * as far as it needs to end inside the viewport, and capped to the viewport.
 */
export function placeSidePopupVertically(
  itemTop: number,
  height: number,
  viewportHeight: number,
  { margin = 8 }: { readonly margin?: number } = {},
): { readonly top: number; readonly maxHeight: number } {
  const maxHeight = Math.max(0, viewportHeight - margin * 2)
  const shown = Math.min(height, maxHeight)
  return { maxHeight, top: Math.max(margin, Math.min(itemTop, viewportHeight - margin - shown)) }
}

/** Moves keyboard focus to a menu item and keeps it visible inside a scrolling menu. */
export function focusMenuItem(item: HTMLElement | null | undefined): void {
  if (!item) return
  item.focus()
  item.scrollIntoView?.({ block: 'nearest' })
}
