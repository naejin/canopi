import Konva from 'konva'
import { getCommonNames } from '../ipc/species'
import { getCanvasColor } from './theme-refresh'
import type { ScreenGrid, ScreenPlant } from './runtime/screen-grid'

// Re-export for canvas-internal consumers (display-modes.ts)
export { STRATUM_I18N_KEY } from '../types/constants'

// Strata color map — keyed by RAW DB values (lowercase).
// Konva cannot read CSS vars, so hex values are required.
const STRATA_COLORS: Record<string, string> = {
  'emergent':     '#1B5E20',
  'high':         '#2E7D32',
  'low':          '#388E3C',
  'medium':       '#558B2F',
}
const DEFAULT_PLANT_COLOR = '#4CAF50'

// All plant circles use a fixed screen-pixel radius for maximum readability.
// Real canopy spread visualization is a Phase 3 toggle ("Display: Canopy spread").
export const CIRCLE_SCREEN_PX = 8       // radius in screen pixels — consistent for all plants

/** "Lavandula angustifolia" → "L. ang." */
function abbreviateCanonical(name: string): string {
  const parts = name.split(' ')
  return parts.length >= 2
    ? `${parts[0]![0]}. ${parts[1]!.slice(0, 3)}.`
    : name.slice(0, 6)
}
const LABEL_FONT_SIZE = 11       // screen pixels
const LABEL_GAP = 4              // screen pixels below the circle

export function getStratumColor(stratum: string | null): string {
  if (!stratum) return DEFAULT_PLANT_COLOR
  return STRATA_COLORS[stratum] ?? DEFAULT_PLANT_COLOR
}

// LOD thresholds — based on how many screen pixels a 1m world unit occupies
export type PlantLOD = 'dot' | 'icon' | 'icon+label'

export function getPlantLOD(stageScale: number): PlantLOD {
  // stageScale = pixels per meter
  // At 5+ px/m: icon+label (zoomed in close — labels readable without overlap)
  // At 0.5–5 px/m: icon only (labels would overlap at normal zoom)
  // At <0.5 px/m: dots only (far out overview)
  if (stageScale < 0.5) return 'dot'
  if (stageScale < 5) return 'icon'
  return 'icon+label'
}

/**
 * Create a plant node as a Konva.Group containing a canopy circle + label.
 *
 * The circle radius is in WORLD units (meters) — it scales with zoom naturally,
 * representing the actual canopy spread.
 *
 * The label is in SCREEN pixels — counter-scaled so it's always readable.
 * Pass the current stage scale so the label starts at the right size.
 */
export function createPlantNode(opts: {
  id: string
  canonicalName: string
  commonName: string | null
  stratum: string | null
  canopySpreadM: number | null
  position: { x: number; y: number }
  stageScale?: number
  notes?: string | null
  plantedDate?: string | null
  quantity?: number | null
}): Konva.Group {
  const color = getStratumColor(opts.stratum)
  const inv = opts.stageScale ? 1 / opts.stageScale : 1

  const abbreviation = abbreviateCanonical(opts.canonicalName)

  // The GROUP is counter-scaled (scale = 1/stageScale) so all children use
  // plain screen-pixel values for sizes and positions. The group's world-space
  // position (x, y) places the plant correctly; the counter-scale keeps the
  // visual size constant. This means ONE scale update per plant on zoom — no
  // per-child iteration needed.
  const group = new Konva.Group({
    id: opts.id,
    x: opts.position.x,
    y: opts.position.y,
    draggable: false,
    name: 'plant-group shape',
    scaleX: inv,
    scaleY: inv,
  })

  // Plant metadata for serialization
  group.setAttr('data-canonical-name', opts.canonicalName)
  group.setAttr('data-common-name', opts.commonName ?? '')
  group.setAttr('data-stratum', opts.stratum ?? '')
  group.setAttr('data-canopy-spread', opts.canopySpreadM ?? 0)
  group.setAttr('data-notes', opts.notes ?? null)
  group.setAttr('data-planted-date', opts.plantedDate ?? null)
  group.setAttr('data-quantity', opts.quantity ?? null)

  // Circle — all values in screen pixels (group counter-scale handles world mapping)
  const circle = new Konva.Circle({
    radius: CIRCLE_SCREEN_PX,
    fill: color,
    opacity: 0.5,
    stroke: color,
    strokeWidth: 1.5,
    name: 'plant-circle',  // NO 'shape' — only the parent group is selectable/draggable
    hitStrokeWidth: CIRCLE_SCREEN_PX + 4,
  })
  group.add(circle)

  // Primary label — common name or botanical abbreviation
  const displayName = opts.commonName || abbreviation
  const label = new Konva.Text({
    text: displayName,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: 'Inter, sans-serif',
    fontStyle: opts.commonName ? 'normal' : 'italic',
    fill: getCanvasColor('plant-label'),
    listening: false,
    name: 'plant-label',
  })
  label.offsetX(label.width() / 2)
  label.y(CIRCLE_SCREEN_PX + LABEL_GAP)
  group.add(label)

  // Secondary label — botanical abbreviation (only if common name is shown)
  if (opts.commonName) {
    const botLabel = new Konva.Text({
      text: abbreviation,
      fontSize: LABEL_FONT_SIZE - 2,
      fontFamily: 'Inter, sans-serif',
      fontStyle: 'italic',
      fill: getCanvasColor('plant-label-muted'),
      listening: false,
      name: 'plant-botanical',
    })
    botLabel.offsetX(botLabel.width() / 2)
    botLabel.y(CIRCLE_SCREEN_PX + LABEL_GAP + LABEL_FONT_SIZE + 2)
    group.add(botLabel)
  }

  return group
}

// Squared distance thresholds — compared against dx²+dy² to avoid sqrt
const MIN_LABEL_DIST_SQ = 40 * 40   // labels suppressed when neighbor closer than 40px
const STACK_THRESHOLD_SQ = 5 * 5    // plants within 5px are "stacked"

// Badge colors — hardcoded hex because Konva can't read CSS vars
const STACK_BADGE_BG = '#5A7D3A'   // moss green from semantic palette
const STACK_BADGE_FG = '#FFFFFF'

export function updatePlantCounterScale(
  plantsLayer: Konva.Layer,
  stageScale: number,
): void {
  const inv = 1 / stageScale
  const groups = plantsLayer.find('.plant-group') as Konva.Group[]
  for (const group of groups) {
    group.scale({ x: inv, y: inv })
  }
  plantsLayer.batchDraw()
}

export function updatePlantLOD(
  plantsLayer: Konva.Layer,
  lod: PlantLOD,
  selectedIds?: Set<string>,
): void {
  const groups = plantsLayer.find('.plant-group') as Konva.Group[]

  for (const group of groups) {
    const label = group.findOne('.plant-label') as Konva.Text | undefined
    const botanicalLabel = group.findOne('.plant-botanical') as Konva.Text | undefined
    const isSelected = selectedIds?.has(group.id()) ?? false

    if (lod === 'dot' || lod === 'icon') {
      if (label) label.visible(isSelected)
      if (botanicalLabel) botanicalLabel.visible(false)
      continue
    }

    if (label) label.visible(true)
    if (botanicalLabel) botanicalLabel.visible(true)
  }

  plantsLayer.batchDraw()
}

export function updatePlantDensity(
  groups: Konva.Group[],
  lod: PlantLOD,
  selectedIds: Set<string> | undefined,
  grid: ScreenGrid,
): void {
  if (lod !== 'icon+label') return

  const positions = collectScreenPlants(groups)
  const anchors = positions
    .slice()
    .sort((left, right) => (left.sy - right.sy) || (left.sx - right.sx))
  const shown = new Set<string>()

  for (const plant of anchors) {
    const label = plant.group.findOne('.plant-label') as Konva.Text | undefined
    const botanicalLabel = plant.group.findOne('.plant-botanical') as Konva.Text | undefined
    const isSelected = selectedIds?.has(plant.group.id()) ?? false

    if (isSelected) {
      label?.visible(true)
      botanicalLabel?.visible(true)
      shown.add(plant.group.id())
      continue
    }

    const neighbors = grid.queryNeighbors(plant.sx, plant.sy, Math.sqrt(MIN_LABEL_DIST_SQ))
    const blocked = neighbors.some((neighbor) => {
      if (neighbor.group.id() === plant.group.id()) return false
      const dx = plant.sx - neighbor.sx
      const dy = plant.sy - neighbor.sy
      return shown.has(neighbor.group.id()) && (dx * dx + dy * dy) < MIN_LABEL_DIST_SQ
    })

    const visible = !blocked
    label?.visible(visible)
    botanicalLabel?.visible(visible)
    if (visible) shown.add(plant.group.id())
  }
}

// Badge positioning constants (screen pixels)
const BADGE_RADIUS = 7
const BADGE_OFFSET_X = CIRCLE_SCREEN_PX + 2
const BADGE_OFFSET_Y = -(CIRCLE_SCREEN_PX + 2)

/**
 * Find plants within STACK_THRESHOLD screen pixels of each other and
 * show/update count badges on the topmost plant in each cluster.
 *
 * Badges are cached as named children ('stackBadgeBg' / 'stackBadgeText')
 * on each group. On subsequent calls we reuse existing Konva nodes —
 * updating text and toggling visibility — instead of destroying and
 * recreating them every zoom event.
 */
export function updatePlantStacking(
  groups: Konva.Group[],
  grid: ScreenGrid,
): void {
  const positions = collectScreenPlants(groups)
  // Phase 1 — compute stack counts per anchor
  const stackCounts = new Map<string, number>()

  if (positions.length >= 2) {
    const visited = new Set<string>()

    for (const plant of positions) {
      if (visited.has(plant.group.id())) continue

      const stack = [plant]
      visited.add(plant.group.id())

      for (const neighbor of grid.queryNeighbors(plant.sx, plant.sy, Math.sqrt(STACK_THRESHOLD_SQ))) {
        if (visited.has(neighbor.group.id()) || neighbor.group.id() === plant.group.id()) continue
        const dx = plant.sx - neighbor.sx
        const dy = plant.sy - neighbor.sy
        if (dx * dx + dy * dy < STACK_THRESHOLD_SQ) {
          stack.push(neighbor)
          visited.add(neighbor.group.id())
        }
      }

      if (stack.length >= 2) {
        stackCounts.set(plant.group.id(), stack.length)
      }
    }
  }

  // Phase 2 — reconcile badges on each group
  for (const plant of positions) {
    const g = plant.group
    const count = stackCounts.get(g.id())

    if (!count) {
      // Only search for badge nodes if we know they were created before
      if (g.getAttr('data-stack-count') != null) {
        g.setAttr('data-stack-count', null)
        const existingBg = g.findOne('.stackBadgeBg') as Konva.Circle | undefined
        const existingText = g.findOne('.stackBadgeText') as Konva.Text | undefined
        if (existingBg) existingBg.visible(false)
        if (existingText) existingText.visible(false)
      }
      continue
    }

    // Stack detected — update or create badge
    g.setAttr('data-stack-count', count)

    let bgCircle = g.findOne('.stackBadgeBg') as Konva.Circle | undefined
    let badgeText = g.findOne('.stackBadgeText') as Konva.Text | undefined

    if (bgCircle && badgeText) {
      // Reuse existing nodes — just update text and ensure visible
      badgeText.text(String(count))
      badgeText.x(BADGE_OFFSET_X - badgeText.width() / 2)
      badgeText.y(BADGE_OFFSET_Y - badgeText.height() / 2)
      bgCircle.visible(true)
      badgeText.visible(true)
    } else {
      // First time — create badge nodes
      bgCircle = new Konva.Circle({
        name: 'stackBadgeBg',
        x: BADGE_OFFSET_X,
        y: BADGE_OFFSET_Y,
        radius: BADGE_RADIUS,
        fill: STACK_BADGE_BG,
        listening: false,
      })

      badgeText = new Konva.Text({
        name: 'stackBadgeText',
        text: String(count),
        fontSize: 9,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: STACK_BADGE_FG,
        listening: false,
        align: 'center',
        verticalAlign: 'middle',
      })
      badgeText.x(BADGE_OFFSET_X - badgeText.width() / 2)
      badgeText.y(BADGE_OFFSET_Y - badgeText.height() / 2)

      g.add(bgCircle)
      g.add(badgeText)
    }
  }
}

function collectScreenPlants(groups: Konva.Group[]): ScreenPlant[] {
  return groups.map((group) => {
    const abs = group.getAbsolutePosition()
    return {
      group,
      sx: abs.x,
      sy: abs.y,
    }
  })
}

/**
 * Update all plant labels to the current locale's common names.
 * Fetches common names in batch from the plant DB, then updates each
 * plant group's label text and data-common-name attr.
 */
export async function updatePlantLabelsForLocale(
  plantsLayer: Konva.Layer,
  locale: string,
): Promise<void> {
  // Collect all canonical names from placed plants
  const names: string[] = []
  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const name = (node as Konva.Group).getAttr('data-canonical-name') as string
    if (name) names.push(name)
  })

  if (names.length === 0) return

  // Batch lookup — one IPC call for all plants
  let nameMap: Record<string, string>
  try {
    nameMap = await getCommonNames(names, locale)
  } catch {
    return // DB not ready or error — keep existing labels
  }

  // Update each plant group's labels.
  // Children use screen-pixel coordinates — group counter-scale handles the rest.
  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const g = node as Konva.Group
    const canonical = g.getAttr('data-canonical-name') as string
    if (!canonical) return

    const commonName = nameMap[canonical] ?? null
    g.setAttr('data-common-name', commonName ?? '')

    const abbreviation = abbreviateCanonical(canonical)

    // Update primary label
    const label = g.findOne('.plant-label') as Konva.Text | undefined
    if (label) {
      label.text(commonName || abbreviation)
      label.fontStyle(commonName ? 'normal' : 'italic')
      label.offsetX(label.width() / 2)
    }

    // Update or create secondary botanical label
    const botLabel = g.findOne('.plant-botanical') as Konva.Text | undefined
    if (commonName && !botLabel) {
      const newBot = new Konva.Text({
        text: abbreviation,
        fontSize: LABEL_FONT_SIZE - 2,
        fontFamily: 'Inter, sans-serif',
        fontStyle: 'italic',
        fill: getCanvasColor('plant-label-muted'),
        listening: false,
        name: 'plant-botanical',
      })
      newBot.offsetX(newBot.width() / 2)
      newBot.y(CIRCLE_SCREEN_PX + LABEL_GAP + LABEL_FONT_SIZE + 2)
      g.add(newBot)
    } else if (botLabel) {
      if (commonName) {
        botLabel.text(abbreviation)
        botLabel.offsetX(botLabel.width() / 2)
      } else {
        botLabel.destroy()
      }
    }
  })

  plantsLayer.batchDraw()
}
