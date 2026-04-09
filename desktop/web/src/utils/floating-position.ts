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
