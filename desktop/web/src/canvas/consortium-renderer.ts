import type { Consortium, PlacedPlant } from '../types/design'
import { getStratumColor } from './plants'
import { DEFAULT_PLANT_COLOR } from './plant-colors'
import { cssVar, roundRect } from './canvas2d-utils'

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
  selectedCanonical: string | null
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

export function rowY(rowIndex: number, rowHeights: number[]): number {
  let y = HEADER_HEIGHT
  for (let i = 0; i < rowIndex; i++) y += (rowHeights[i] ?? MIN_ROW_HEIGHT)
  return y
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

export function buildConsortiumBars(
  entries: Consortium[],
  plants: PlacedPlant[],
  speciesColors: Record<string, string>,
): ConsortiumBarLayout[] {
  const plantCounts = new Map<string, { count: number; commonName: string }>()
  for (const plant of plants) {
    const existing = plantCounts.get(plant.canonical_name)
    if (existing) {
      existing.count++
    } else {
      plantCounts.set(plant.canonical_name, {
        count: 1,
        commonName: plant.common_name ?? plant.canonical_name,
      })
    }
  }

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

  for (const group of byStratum.values()) {
    group.sort((a, b) => a.startPhase - b.startPhase || a.endPhase - b.endPhase)
    const laneEnds: number[] = []

    for (const bar of group) {
      let assigned = -1
      for (let i = 0; i < laneEnds.length; i++) {
        if (bar.startPhase > laneEnds[i]!) {
          assigned = i
          laneEnds[i] = bar.endPhase
          break
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length
        laneEnds.push(bar.endPhase)
      }
      bar.subLane = assigned
    }

    const totalSubLanes = Math.max(laneEnds.length, 1)
    for (const bar of group) {
      bar.totalSubLanes = totalSubLanes
    }
  }

  return bars
}

// ---------------------------------------------------------------------------
// Bar geometry
// ---------------------------------------------------------------------------

export interface BarRect { x: number; y: number; w: number; h: number }

export function computeBarRect(bar: ConsortiumBarLayout, contentWidth: number, rowHeights: number[]): BarRect {
  const rowIdx = stratumToRow(bar.stratum)
  const ry = rowY(rowIdx, rowHeights)
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
): void {
  const bgColor = cssVar('--color-bg') || '#E6E0D4'
  const surfaceColor = cssVar('--color-surface') || '#EDE8DD'
  const surfaceMuted = cssVar('--color-surface-muted') || '#E8E2D6'
  const borderColor = cssVar('--color-border') || 'rgba(60, 45, 30, 0.16)'
  const textColor = cssVar('--color-text') || '#2C2418'
  const textMutedColor = cssVar('--color-text-muted') || '#6B5F4E'
  const primaryColor = cssVar('--color-primary') || '#A06B1F'
  const fontSans = cssVar('--font-sans') || 'Inter, system-ui, sans-serif'

  const contentWidth = width - LABEL_WIDTH
  const gridHeight = rowHeights.reduce((a, b) => a + b, 0)

  ctx.clearRect(0, 0, width, height)

  // -- Full background --------------------------------------------------------
  ctx.fillStyle = surfaceColor
  ctx.fillRect(0, 0, width, height)

  // -- Alternating row backgrounds --------------------------------------------
  for (let r = 0; r < STRATA_ROWS.length; r++) {
    const ry = rowY(r, rowHeights)
    const rh = rowHeights[r] ?? MIN_ROW_HEIGHT
    ctx.fillStyle = r % 2 === 0 ? surfaceColor : surfaceMuted
    ctx.fillRect(LABEL_WIDTH, ry, contentWidth, rh)
  }

  // -- Label sidebar ----------------------------------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT + gridHeight)

  // -- Column headers ---------------------------------------------------------
  for (let i = 0; i < CONSORTIUM_PHASES.length; i++) {
    const phase = CONSORTIUM_PHASES[i]!
    const x1 = phaseToX(i, contentWidth)
    const x2 = phaseToX(i + 1, contentWidth)
    const colW = x2 - x1
    const cx = x1 + colW / 2

    ctx.textAlign = 'center'

    // Phase name
    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    ctx.fillText(t(phase.labelKey), cx, HEADER_HEIGHT / 2 - 1, colW - 8)

    // Duration subtitle
    ctx.fillStyle = textMutedColor
    ctx.font = `400 10px ${fontSans}`
    ctx.fillText(t(phase.durationKey), cx, HEADER_HEIGHT / 2 + 11, colW - 8)
  }

  ctx.textAlign = 'left'

  // -- Row labels -------------------------------------------------------------
  for (let r = 0; r < STRATA_ROWS.length; r++) {
    const stratum = STRATA_ROWS[r]!
    const ry = rowY(r, rowHeights)
    const rh = rowHeights[r] ?? MIN_ROW_HEIGHT
    const labelY = ry + rh / 2

    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    ctx.save()
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
    const y = rowY(r, rowHeights) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  // Vertical phase dividers (lighter)
  ctx.globalAlpha = 0.5
  for (let i = 1; i < CONSORTIUM_PHASES.length; i++) {
    const x = phaseToX(i, contentWidth) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, HEADER_HEIGHT)
    ctx.lineTo(x, HEADER_HEIGHT + gridHeight)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // -- Bars -------------------------------------------------------------------
  for (const bar of bars) {
    const { x, y: barY, w: barW, h: barH } = computeBarRect(bar, contentWidth, rowHeights)

    const isHovered = bar.canonicalName === state.hoveredCanonical
    const isSelected = bar.canonicalName === state.selectedCanonical

    // Bar shadow (subtle depth)
    if (isHovered) {
      ctx.save()
      ctx.shadowColor = 'rgba(44, 36, 24, 0.15)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 1
      ctx.fillStyle = bar.color
      roundRect(ctx, x, barY, barW, barH, BAR_RADIUS)
      ctx.fill()
      ctx.restore()
    }

    // Bar fill
    ctx.fillStyle = bar.color
    ctx.globalAlpha = isHovered ? 1 : 0.85
    roundRect(ctx, x, barY, barW, barH, BAR_RADIUS)
    ctx.fill()
    ctx.globalAlpha = 1

    // Border
    ctx.strokeStyle = isSelected ? primaryColor : isHovered ? primaryColor : 'rgba(0,0,0,0.12)'
    ctx.lineWidth = isSelected ? 2 : 1
    if (isHovered) ctx.globalAlpha = 0.7
    roundRect(ctx, x, barY, barW, barH, BAR_RADIUS)
    ctx.stroke()
    ctx.globalAlpha = 1

    // Label inside bar
    if (barW > 50) {
      // Dark text on colored background for readability
      ctx.fillStyle = '#fff'
      ctx.globalAlpha = 0.95
      ctx.font = `600 10px ${fontSans}`
      ctx.save()
      ctx.beginPath()
      ctx.rect(x + 4, barY, barW - 8, barH)
      ctx.clip()
      const label = bar.count > 0
        ? `${bar.commonName} (${bar.count})`
        : bar.commonName
      ctx.fillText(label, x + 7, barY + barH / 2 + 3.5)
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (barW > 20) {
      // Just show count for narrow bars
      ctx.fillStyle = '#fff'
      ctx.globalAlpha = 0.9
      ctx.font = `600 9px ${fontSans}`
      ctx.textAlign = 'center'
      ctx.fillText(`${bar.count}`, x + barW / 2, barY + barH / 2 + 3)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
    }
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
  _height: number,
  rowHeights: number[],
): ConsortiumHitResult | null {
  const contentWidth = width - LABEL_WIDTH

  if (x < LABEL_WIDTH || y < HEADER_HEIGHT) return null

  for (const bar of bars) {
    const r = computeBarRect(bar, contentWidth, rowHeights)

    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      if (x - r.x < EDGE_THRESHOLD) return { canonicalName: bar.canonicalName, edge: 'left' }
      if (r.x + r.w - x < EDGE_THRESHOLD) return { canonicalName: bar.canonicalName, edge: 'right' }
      return { canonicalName: bar.canonicalName, edge: 'body' }
    }
  }

  return null
}
