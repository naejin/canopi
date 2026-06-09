const MS_PER_DAY = 86400000
const AUTO_SCROLL_EDGE_ZONE = 60
const AUTO_SCROLL_MIN_SPEED = 1
const AUTO_SCROLL_MAX_SPEED = 15

export function computeTimelineAutoScrollSpeed(
  mouseX: number,
  chartWidth: number,
  labelSidebarWidth: number,
): number {
  if (mouseX < labelSidebarWidth + AUTO_SCROLL_EDGE_ZONE) {
    const depth = labelSidebarWidth + AUTO_SCROLL_EDGE_ZONE - mouseX
    const ratio = Math.min(depth / AUTO_SCROLL_EDGE_ZONE, 1)
    return -(AUTO_SCROLL_MIN_SPEED + (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) * ratio * ratio)
  }
  if (mouseX > chartWidth - AUTO_SCROLL_EDGE_ZONE) {
    const depth = mouseX - (chartWidth - AUTO_SCROLL_EDGE_ZONE)
    const ratio = Math.min(depth / AUTO_SCROLL_EDGE_ZONE, 1)
    return AUTO_SCROLL_MIN_SPEED + (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) * ratio * ratio
  }
  return 0
}

export function compensateFrozenTimelineOriginScroll({
  frozenOriginMs,
  realOriginMs,
  scrollX,
  pxPerDay,
}: {
  readonly frozenOriginMs: number
  readonly realOriginMs: number
  readonly scrollX: number
  readonly pxPerDay: number
}): number {
  if (frozenOriginMs === realOriginMs) return scrollX
  const deltaDays = (frozenOriginMs - realOriginMs) / MS_PER_DAY
  return scrollX + deltaDays * pxPerDay
}
