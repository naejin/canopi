import type { Consortium, PlacedPlant } from '../types/design'
import { getStratumColor } from './plants'
import { DEFAULT_PLANT_COLOR } from './plant-colors'
import { cssVar, roundRect, readThemeTokens } from './canvas2d-utils'
import { groupPlantsBySpecies } from './plant-grouping'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONSORTIUM_PHASES = [
  { key: 'placenta1', labelKey: 'canvas.consortium.phase_placenta1', durationKey: 'canvas.consortium.duration_90d' },
  { key: 'placenta2', labelKey: 'canvas.consortium.phase_placenta2', durationKey: 'canvas.consortium.duration_2y' },
  { key: 'placenta3', labelKey: 'canvas.consortium.phase_placenta3', durationKey: 'canvas.consortium.duration_5y' },
  { key: 'secondaire1', labelKey: 'canvas.consortium.phase_secondaire1', durationKey: 'canvas.consortium.duration_10y' },
  { key: 'secondaire2', labelKey: 'canvas.consortium.phase_secondaire2', durationKey: 'canvas.consortium.duration_20y' },
  { key: 'secondaire3', labelKey: 'canvas.consortium.phase_secondaire3', durationKey: 'canvas.consortium.duration_40y' },
  { key: 'climax', labelKey: 'canvas.consortium.phase_climax', durationKey: 'canvas.consortium.duration_60y' },
] as const

export const STRATA_ROWS = ['emergent', 'high', 'medium', 'low', 'unassigned'] as const

export const MIN_ROW_HEIGHT = 36
export const LANE_HEIGHT = 32
export const HEADER_HEIGHT = 36
export const LABEL_WIDTH = 130
const BAR_HEIGHT = 26
const BAR_MARGIN = 3
const BAR_RADIUS = 4
const EDGE_THRESHOLD = 6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsortiumRenderState {
  hoveredCanonical: string | null
}

export interface ConsortiumBarLayout {
  canonicalName: string
  stratum: string
  startPhase: number
  endPhase: number
  subLane: number
  totalSubLanes: number
  color: string
  commonName: string
  count: number
}

export interface ConsortiumHitResult {
  canonicalName: string
  edge: 'left' | 'right' | 'body'
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

export function phaseToX(phase: number, contentWidth: number): number {
  return LABEL_WIDTH + (phase / CONSORTIUM_PHASES.length) * contentWidth
}

export function xToPhase(x: number, contentWidth: number): number {
  const fraction = (x - LABEL_WIDTH) / contentWidth
  return Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, fraction * CONSORTIUM_PHASES.length))
}

export function stratumToRow(stratum: string): number {
  const idx = (STRATA_ROWS as readonly string[]).indexOf(stratum)
  return idx === -1 ? 4 : idx
}

// ---------------------------------------------------------------------------
// Dynamic row sizing
// ---------------------------------------------------------------------------

export function computeRowHeights(bars: ConsortiumBarLayout[]): number[] {
  const laneCounts = new Array(STRATA_ROWS.length).fill(1) as number[]
  for (const bar of bars) {
    const rowIdx = stratumToRow(bar.stratum)
    laneCounts[rowIdx] = Math.max(laneCounts[rowIdx]!, bar.totalSubLanes)
  }
  return laneCounts.map(lanes => Math.max(MIN_ROW_HEIGHT, lanes * LANE_HEIGHT))
}

/** Precompute cumulative Y offsets for all rows. */
export function computeRowYOffsets(rowHeights: number[]): number[] {
  const offsets = new Array(rowHeights.length + 1) as number[]
  offsets[0] = HEADER_HEIGHT
  for (let i = 0; i < rowHeights.length; i++) {
    offsets[i + 1] = offsets[i]! + (rowHeights[i] ?? MIN_ROW_HEIGHT)
  }
  return offsets
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

export function buildConsortiumBars(
  entries: Consortium[],
  plants: PlacedPlant[],
  speciesColors: Record<string, string>,
  localizedNames?: ReadonlyMap<string, string | null>,
): ConsortiumBarLayout[] {
  const plantCounts = groupPlantsBySpecies(plants, localizedNames)

  const bars: ConsortiumBarLayout[] = entries.map((entry) => {
    const plantInfo = plantCounts.get(entry.canonical_name)
    return {
      canonicalName: entry.canonical_name,
      stratum: entry.stratum,
      startPhase: entry.start_phase,
      endPhase: entry.end_phase,
      subLane: 0,
      totalSubLanes: 1,
      color: speciesColors[entry.canonical_name] ?? getStratumColor(entry.stratum) ?? DEFAULT_PLANT_COLOR,
      commonName: plantInfo?.commonName ?? entry.canonical_name,
      count: plantInfo?.count ?? 0,
    }
  })

  const byStratum = new Map<string, ConsortiumBarLayout[]>()
  for (const bar of bars) {
    const group = byStratum.get(bar.stratum)
    if (group) group.push(bar)
    else byStratum.set(bar.stratum, [bar])
  }

  // Sub-lane order follows array position (user-reorderable, no auto-sort)
  for (const group of byStratum.values()) {
    for (let i = 0; i < group.length; i++) {
      group[i]!.subLane = i
      group[i]!.totalSubLanes = group.length
    }
  }

  return bars
}

// ---------------------------------------------------------------------------
// Bar geometry
// ---------------------------------------------------------------------------

export interface BarRect { x: number; y: number; w: number; h: number }

export function computeBarRect(bar: ConsortiumBarLayout, contentWidth: number, rowHeights: number[], rowOffsets: number[]): BarRect {
  const rowIdx = stratumToRow(bar.stratum)
  const ry = rowOffsets[rowIdx]!
  const rh = rowHeights[rowIdx] ?? MIN_ROW_HEIGHT
  const subLaneH = rh / bar.totalSubLanes
  const x1 = phaseToX(bar.startPhase, contentWidth)
  const x2 = phaseToX(bar.endPhase + 1, contentWidth)
  return {
    x: x1,
    y: ry + bar.subLane * subLaneH + BAR_MARGIN,
    w: Math.max(x2 - x1, 8),
    h: Math.min(BAR_HEIGHT, subLaneH - BAR_MARGIN * 2),
  }
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderConsortium(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bars: ConsortiumBarLayout[],
  state: ConsortiumRenderState,
  t: (key: string) => string,
  rowHeights: number[],
  cachedRowOffsets?: number[],
): void {
  const theme = readThemeTokens()
  const bgColor = theme.bg
  const surfaceColor = theme.surface
  const surfaceMuted = cssVar('--color-surface-muted') || '#E8E3D9'
  const borderColor = theme.border
  const textColor = theme.text
  const textMutedColor = theme.textMuted
  const primaryColor = theme.primary
  const primaryContrastColor = theme.primaryContrast
  const fontSans = theme.fontSans

  const contentWidth = width - LABEL_WIDTH
  const rowOffsets = cachedRowOffsets ?? computeRowYOffsets(rowHeights)
  const gridHeight = rowOffsets[rowOffsets.length - 1]! - HEADER_HEIGHT

  ctx.clearRect(0, 0, width, height)

  // -- Full background --------------------------------------------------------
  ctx.fillStyle = surfaceColor
  ctx.fillRect(0, 0, width, height)

  // -- Alternating row backgrounds --------------------------------------------
  for (let r = 0; r < STRATA_ROWS.length; r++) {
    const ry = rowOffsets[r]!
    const rh = rowHeights[r] ?? MIN_ROW_HEIGHT
    ctx.fillStyle = r % 2 === 0 ? surfaceColor : surfaceMuted
    ctx.fillRect(LABEL_WIDTH, ry, contentWidth, rh)
  }

  // -- Label sidebar ----------------------------------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT + gridHeight)

  // -- Column headers ---------------------------------------------------------
  ctx.save()
  ctx.textAlign = 'center'
  for (let i = 0; i < CONSORTIUM_PHASES.length; i++) {
    const phase = CONSORTIUM_PHASES[i]!
    const x1 = phaseToX(i, contentWidth)
    const x2 = phaseToX(i + 1, contentWidth)
    const colW = x2 - x1
    const cx = x1 + colW / 2

    // Phase name
    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    ctx.fillText(t(phase.labelKey), cx, HEADER_HEIGHT / 2 - 1, colW - 8)

    // Duration subtitle
    ctx.fillStyle = textMutedColor
    ctx.font = `400 11px ${fontSans}`
    ctx.fillText(t(phase.durationKey), cx, HEADER_HEIGHT / 2 + 11, colW - 8)
  }
  ctx.restore()

  // -- Row labels -------------------------------------------------------------
  for (let r = 0; r < STRATA_ROWS.length; r++) {
    const stratum = STRATA_ROWS[r]!
    const ry = rowOffsets[r]!
    const rh = rowHeights[r] ?? MIN_ROW_HEIGHT
    const labelY = ry + rh / 2

    ctx.save()
    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    ctx.beginPath()
    ctx.rect(0, ry, LABEL_WIDTH - 4, rh)
    ctx.clip()
    ctx.fillText(t('canvas.consortium.' + stratum), 10, labelY + 4)
    ctx.restore()
  }

  // -- Grid lines -------------------------------------------------------------
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1

  // Header bottom border
  ctx.beginPath()
  ctx.moveTo(0, HEADER_HEIGHT + 0.5)
  ctx.lineTo(width, HEADER_HEIGHT + 0.5)
  ctx.stroke()

  // Sidebar right border
  ctx.beginPath()
  ctx.moveTo(LABEL_WIDTH + 0.5, 0)
  ctx.lineTo(LABEL_WIDTH + 0.5, HEADER_HEIGHT + gridHeight)
  ctx.stroke()

  // Horizontal row dividers
  for (let r = 1; r <= STRATA_ROWS.length; r++) {
    const y = rowOffsets[r]! + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  // Vertical phase dividers (lighter)
  ctx.save()
  ctx.globalAlpha = 0.5
  for (let i = 1; i < CONSORTIUM_PHASES.length; i++) {
    const x = phaseToX(i, contentWidth) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, HEADER_HEIGHT)
    ctx.lineTo(x, HEADER_HEIGHT + gridHeight)
    ctx.stroke()
  }
  ctx.restore()

  // -- Bars -------------------------------------------------------------------
  for (const bar of bars) {
    const { x, y: barY, w: barW, h: barH } = computeBarRect(bar, contentWidth, rowHeights, rowOffsets)

    const isHovered = bar.canonicalName === state.hoveredCanonical

    ctx.save()

    // Bar shadow (subtle depth)
    if (isHovered) {
      ctx.shadowColor = borderColor
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 1
    }

    // Bar fill
    ctx.fillStyle = bar.color
    ctx.globalAlpha = isHovered ? 1 : 0.85
    roundRect(ctx, x, barY, barW, barH, BAR_RADIUS)
    ctx.fill()

    // Clear shadow before border (shadow only applies to fill)
    ctx.shadowColor = 'transparent'

    // Border
    ctx.strokeStyle = isHovered ? primaryColor : borderColor
    ctx.lineWidth = 1
    ctx.globalAlpha = isHovered ? 0.7 : 1
    roundRect(ctx, x, barY, barW, barH, BAR_RADIUS)
    ctx.stroke()

    // Label inside bar
    if (barW > 50) {
      ctx.globalAlpha = 0.95
      ctx.fillStyle = primaryContrastColor
      ctx.font = `600 11px ${fontSans}`
      ctx.beginPath()
      ctx.rect(x + 4, barY, barW - 8, barH)
      ctx.clip()
      const label = bar.count > 0
        ? `${bar.commonName} (${bar.count})`
        : bar.commonName
      ctx.fillText(label, x + 7, barY + barH / 2 + 3.5)
    } else if (barW > 20) {
      ctx.globalAlpha = 0.9
      ctx.fillStyle = primaryContrastColor
      ctx.font = `600 11px ${fontSans}`
      ctx.textAlign = 'center'
      ctx.fillText(`${bar.count}`, x + barW / 2, barY + barH / 2 + 3)
    }

    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export function hitTestBar(
  x: number,
  y: number,
  bars: ConsortiumBarLayout[],
  width: number,
  rowHeights: number[],
  rowOffsets?: number[],
): ConsortiumHitResult | null {
  const contentWidth = width - LABEL_WIDTH

  if (x < LABEL_WIDTH || y < HEADER_HEIGHT) return null

  const offsets = rowOffsets ?? computeRowYOffsets(rowHeights)
  for (const bar of bars) {
    const r = computeBarRect(bar, contentWidth, rowHeights, offsets)

    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      if (r.w <= EDGE_THRESHOLD * 2) return { canonicalName: bar.canonicalName, edge: 'body' }
      if (x - r.x < EDGE_THRESHOLD) return { canonicalName: bar.canonicalName, edge: 'left' }
      if (r.x + r.w - x < EDGE_THRESHOLD) return { canonicalName: bar.canonicalName, edge: 'right' }
      return { canonicalName: bar.canonicalName, edge: 'body' }
    }
  }

  return null
}
