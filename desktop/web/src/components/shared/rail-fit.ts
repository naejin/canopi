/** A rail button's vertical extent, from the rail's top edge. */
export interface RailButtonBox {
  readonly top: number
  readonly bottom: number
}

/**
 * Pure: how many foldable buttons stay on a rail, with a More button after
 * them, so the rail ends within `room`; null when every button fits. `buttons`
 * and `railHeight` are measured with every button shown; a More button takes
 * a button's height and gap, and whatever follows the last foldable button
 * (the tool rail's Undo and Redo) stays after More.
 */
export function railVisibleCount(
  buttons: readonly RailButtonBox[],
  railHeight: number,
  room: number | null,
): number | null {
  if (room === null || buttons.length === 0 || railHeight <= room) return null
  const first = buttons[0]!
  const height = first.bottom - first.top
  const gap = buttons.length > 1 ? Math.max(0, buttons[1]!.top - first.bottom) : 0
  const trailing = railHeight - buttons[buttons.length - 1]!.bottom
  let count = 0
  while (count < buttons.length && buttons[count]!.bottom + gap + height + trailing <= room) count += 1
  return count
}
