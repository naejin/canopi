/** Screen-readable text fades by absolute camera scale (CSS pixels per design meter). */
export function getCanvasTextOpacity(viewportScale: number): number {
  const progress = Math.max(0, Math.min(1, (viewportScale - 8) / 12))
  return progress * progress * (3 - 2 * progress)
}
