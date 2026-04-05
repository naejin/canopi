import type { Consortium, PlacedPlant } from '../types/design'
import { getStratumColor } from './plants'
import { DEFAULT_PLANT_COLOR } from './plant-colors'
import { cssVar, roundRect } from './canvas2d-utils'

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

export const ROW_HEIGHT = 48
export const HEADER_HEIGHT = 40
export const LABEL_WIDTH = 100
const BAR_HEIGHT = 24
const BAR_MARGIN = 4
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
// Theme color helper — reads CSS variables from the document.
// Caches the CSSStyleDeclaration per frame to avoid repeated getComputedStyle
// calls during drag-heavy render loops.
// ---------------------------------------------------------------------------

/** Maps phase index [0..7] to x pixel within the content area (after LABEL_WIDTH). */
export function phaseToX(phase: number, contentWidth: number): number {
  return LABEL_WIDTH + (phase / CONSORTIUM_PHASES.length) * contentWidth
}

/** Inverse of phaseToX — returns fractional phase, clamped to [0..6]. */
export function xToPhase(x: number, contentWidth: number): number {
  const fraction = (x - LABEL_WIDTH) / contentWidth
  return Math.max(0, Math.min(CONSORTIUM_PHASES.length - 1, fraction * CONSORTIUM_PHASES.length))
}

/** Returns row index in STRATA_ROWS, or 4 (unassigned) if not found. */
export function stratumToRow(stratum: string): number {
  const idx = (STRATA_ROWS as readonly string[]).indexOf(stratum)
  return idx === -1 ? 4 : idx
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

/**
 * Build bar layouts from consortium entries and placed plants.
 * Counts plants by canonical_name, assigns colors, and packs overlapping
 * bars within the same stratum into sub-lanes.
 */
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
// Main render
// ---------------------------------------------------------------------------

export function renderConsortium(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bars: ConsortiumBarLayout[],
  state: ConsortiumRenderState,
  t: (key: string) => string,
): void {
  // Read theme tokens
  const bgColor = cssVar('--color-bg') || '#F0EBE1'
  const surfaceColor = cssVar('--color-surface') || '#FAF7F2'
  const borderColor = cssVar('--color-border') || 'rgba(60, 45, 30, 0.12)'
  const textColor = cssVar('--color-text') || '#2C2418'
  const textMutedColor = cssVar('--color-text-muted') || '#7D6F5E'
  const primaryColor = cssVar('--color-primary') || '#A06B1F'
  const fontSans = cssVar('--font-sans') || 'system-ui, sans-serif'

  const contentWidth = width - LABEL_WIDTH

  ctx.clearRect(0, 0, width, height)

  // -- Background fill -------------------------------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, width, height)

  // -- Label sidebar background -----------------------------------------------
  ctx.fillStyle = surfaceColor
  ctx.fillRect(0, 0, LABEL_WIDTH, height)

  // Sidebar border
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(LABEL_WIDTH, 0)
  ctx.lineTo(LABEL_WIDTH, height)
  ctx.stroke()

  // -- Column headers (phases) ------------------------------------------------
  ctx.fillStyle = bgColor
  ctx.fillRect(LABEL_WIDTH, 0, contentWidth, HEADER_HEIGHT)

  // Corner cell (top-left)
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT)

  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1

  // Header bottom border
  ctx.beginPath()
  ctx.moveTo(0, HEADER_HEIGHT)
  ctx.lineTo(width, HEADER_HEIGHT)
  ctx.stroke()

  for (let i = 0; i < CONSORTIUM_PHASES.length; i++) {
    const phase = CONSORTIUM_PHASES[i]!
    const x1 = phaseToX(i, contentWidth)
    const x2 = phaseToX(i + 1, contentWidth)
    const colW = x2 - x1

    // Vertical grid line between phases
    if (i > 0) {
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x1, 0)
      ctx.lineTo(x1, height)
      ctx.stroke()
    }

    // Phase label
    ctx.fillStyle = textColor
    ctx.font = `600 10px ${fontSans}`
    ctx.textAlign = 'center'
    ctx.fillText(t(phase.labelKey), x1 + colW / 2, HEADER_HEIGHT / 2 - 2, colW - 4)

    // Duration label
    ctx.fillStyle = textMutedColor
    ctx.font = `400 10px ${fontSans}`
    ctx.fillText(t(phase.durationKey), x1 + colW / 2, HEADER_HEIGHT / 2 + 10, colW - 4)
  }

  ctx.textAlign = 'left' // reset

  // -- Row labels (strata) ---------------------------------------------------
  for (let r = 0; r < STRATA_ROWS.length; r++) {
    const stratum = STRATA_ROWS[r]!
    const rowY = HEADER_HEIGHT + r * ROW_HEIGHT

    // Alternating row backgrounds
    if (r % 2 === 1) {
      ctx.fillStyle = borderColor
      ctx.globalAlpha = 0.3
      ctx.fillRect(LABEL_WIDTH, rowY, contentWidth, ROW_HEIGHT)
      ctx.globalAlpha = 1
    }

    // Row separator line
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, rowY + ROW_HEIGHT)
    ctx.lineTo(width, rowY + ROW_HEIGHT)
    ctx.stroke()

    // Stratum label in sidebar
    ctx.fillStyle = textColor
    ctx.font = `600 11px ${fontSans}`
    ctx.save()
    ctx.beginPath()
    ctx.rect(4, rowY, LABEL_WIDTH - 8, ROW_HEIGHT)
    ctx.clip()
    ctx.fillText(t('canvas.consortium.' + stratum), 8, rowY + ROW_HEIGHT / 2 + 4)
    ctx.restore()
  }

  // -- Draw bars --------------------------------------------------------------
  for (const bar of bars) {
    const rowIdx = stratumToRow(bar.stratum)
    const rowY = HEADER_HEIGHT + rowIdx * ROW_HEIGHT

    // Compute total row height accounting for sub-lanes
    const subLaneH = ROW_HEIGHT / bar.totalSubLanes

    const x1 = phaseToX(bar.startPhase, contentWidth)
    const x2 = phaseToX(bar.endPhase + 1, contentWidth)
    const barW = Math.max(x2 - x1, 6)
    const barY = rowY + bar.subLane * subLaneH + BAR_MARGIN
    const barH = Math.min(BAR_HEIGHT, subLaneH - BAR_MARGIN * 2)

    // Bar fill
    const isHovered = bar.canonicalName === state.hoveredCanonical
    const isSelected = bar.canonicalName === state.selectedCanonical
    ctx.globalAlpha = isHovered ? 0.9 : 0.8
    ctx.fillStyle = bar.color
    roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
    ctx.fill()
    ctx.globalAlpha = 1

    // Selected outline
    if (isSelected) {
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 2
      roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
      ctx.stroke()
    }

    // Hover outline (lighter)
    if (isHovered && !isSelected) {
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.5
      roundRect(ctx, x1, barY, barW, barH, BAR_RADIUS)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Label inside bar (common name + count)
    if (barW > 40) {
      ctx.fillStyle = surfaceColor
      ctx.font = `600 10px ${fontSans}`
      ctx.save()
      ctx.beginPath()
      ctx.rect(x1 + 2, barY, barW - 4, barH)
      ctx.clip()
      const label = bar.count > 0
        ? `${bar.commonName} (${bar.count})`
        : bar.commonName
      ctx.fillText(label, x1 + 6, barY + barH / 2 + 3.5)
      ctx.restore()
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
): ConsortiumHitResult | null {
  const contentWidth = width - LABEL_WIDTH

  // Ignore clicks in the label sidebar or header
  if (x < LABEL_WIDTH || y < HEADER_HEIGHT) return null

  for (const bar of bars) {
    const rowIdx = stratumToRow(bar.stratum)
    const rowY = HEADER_HEIGHT + rowIdx * ROW_HEIGHT
    const subLaneH = ROW_HEIGHT / bar.totalSubLanes

    const x1 = phaseToX(bar.startPhase, contentWidth)
    const x2 = phaseToX(bar.endPhase + 1, contentWidth)
    const barW = Math.max(x2 - x1, 6)
    const barY = rowY + bar.subLane * subLaneH + BAR_MARGIN
    const barH = Math.min(BAR_HEIGHT, subLaneH - BAR_MARGIN * 2)

    if (x >= x1 && x <= x1 + barW && y >= barY && y <= barY + barH) {
      // Check edges
      if (x - x1 < EDGE_THRESHOLD) {
        return { canonicalName: bar.canonicalName, edge: 'left' }
      }
      if (x1 + barW - x < EDGE_THRESHOLD) {
        return { canonicalName: bar.canonicalName, edge: 'right' }
      }
      return { canonicalName: bar.canonicalName, edge: 'body' }
    }
  }

  return null
}
