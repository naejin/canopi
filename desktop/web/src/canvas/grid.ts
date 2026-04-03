// ---------------------------------------------------------------------------
// Snap-to-grid — pure arithmetic, no renderer dependency
// ---------------------------------------------------------------------------

export function snapToGrid(
  x: number,
  y: number,
  size: number,
): { x: number; y: number } {
  return {
    x: Math.round(x / size) * size,
    y: Math.round(y / size) * size,
  }
}
