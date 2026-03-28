import Konva from 'konva'
import { getCommonNames } from '../ipc/species'
import { getCanvasColor } from './theme-refresh'

// Strata color map — keyed by RAW DB values (lowercase).
// Konva cannot read CSS vars, so hex values are required.
const STRATA_COLORS: Record<string, string> = {
  'emergent':     '#1B5E20',
  'high':         '#2E7D32',
  'low':          '#388E3C',
  'medium':       '#558B2F',
}

// Display-friendly labels for strata — maps raw DB values to i18n keys.
// Used by PlantRow tags and legend entries.
export const STRATUM_I18N_KEY: Record<string, string> = {
  'emergent': 'filters.stratum_emergent',
  'high':     'filters.stratum_high',
  'low':      'filters.stratum_low',
  'medium':   'filters.stratum_medium',
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
    draggable: true,
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

/**
 * Update all plant nodes for the current zoom level:
 * - Counter-scale groups to constant screen size
 * - LOD: hide labels at far zoom, show at close zoom
 * - Nearest-neighbor density: suppress labels when plants are too close
 * - Stacked plant badges: show count when plants overlap
 *
 * Called after zoom changes (debounced 150ms).
 */
export function updatePlantsLOD(
  plantsLayer: Konva.Layer,
  lod: PlantLOD,
  stageScale: number,
  selectedIds?: Set<string>,
): void {
  const inv = 1 / stageScale
  const groups = plantsLayer.find('.plant-group') as Konva.Group[]

  // Collect screen positions for neighbor distance computation
  const positions: { group: Konva.Group; sx: number; sy: number }[] = []
  for (const g of groups) {
    const abs = g.getAbsolutePosition()
    positions.push({ group: g, sx: abs.x, sy: abs.y })
  }

  for (let i = 0; i < positions.length; i++) {
    const g = positions[i]!.group

    // Counter-scale the GROUP — all children (circle, labels) inherit the
    // scale automatically. This is the only per-plant operation needed on zoom.
    g.scale({ x: inv, y: inv })

    // LOD: toggle label visibility based on zoom level
    const label = g.findOne('.plant-label') as Konva.Text | undefined
    const botLabel = g.findOne('.plant-botanical') as Konva.Text | undefined
    const isSelected = selectedIds?.has(g.id()) ?? false

    if (lod === 'dot' || lod === 'icon') {
      // No labels at these zoom levels (unless selected)
      if (label) label.visible(isSelected)
      if (botLabel) botLabel.visible(false)
    } else {
      // icon+label: show label only if nearest neighbor > 40px (squared) or selected
      let nearestDistSq = Infinity
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue
        const dx = positions[i]!.sx - positions[j]!.sx
        const dy = positions[i]!.sy - positions[j]!.sy
        const dSq = dx * dx + dy * dy
        if (dSq < nearestDistSq) nearestDistSq = dSq
      }

      const showLabel = isSelected || nearestDistSq > MIN_LABEL_DIST_SQ
      if (label) label.visible(showLabel)
      if (botLabel) botLabel.visible(showLabel)
    }
  }

  // Stacked plant detection — add/update count badges
  updateStackedBadges(positions, stageScale)

  plantsLayer.batchDraw()
}

/**
 * Find plants within STACK_THRESHOLD screen pixels of each other and add
 * count badges to the topmost plant in each cluster.
 */
function updateStackedBadges(
  positions: { group: Konva.Group; sx: number; sy: number }[],
  _stageScale: number,
): void {
  // Remove all existing badges first
  for (const p of positions) {
    const existing = p.group.find('.stack-badge')
    for (const node of existing) node.destroy()
    // Clear stale stack data attr
    p.group.setAttr('data-stack-count', null)
  }

  if (positions.length < 2) return

  // Simple single-linkage clustering from the first (anchor) plant
  const visited = new Set<number>()

  for (let i = 0; i < positions.length; i++) {
    if (visited.has(i)) continue

    const stack: number[] = [i]
    visited.add(i)

    for (let j = i + 1; j < positions.length; j++) {
      if (visited.has(j)) continue
      const dx = positions[i]!.sx - positions[j]!.sx
      const dy = positions[i]!.sy - positions[j]!.sy
      if (dx * dx + dy * dy < STACK_THRESHOLD_SQ) {
        stack.push(j)
        visited.add(j)
      }
    }

    if (stack.length < 2) continue

    // Badge the anchor (first/topmost) plant in the cluster
    const g = positions[i]!.group
    g.setAttr('data-stack-count', stack.length)

    // Badge background circle — positioned in screen-pixel space (group is
    // already counter-scaled, so plain pixel values work)
    const badgeRadius = 7
    const offsetX = CIRCLE_SCREEN_PX + 2
    const offsetY = -(CIRCLE_SCREEN_PX + 2)

    const bgCircle = new Konva.Circle({
      name: 'stack-badge',
      x: offsetX,
      y: offsetY,
      radius: badgeRadius,
      fill: STACK_BADGE_BG,
      listening: false,
    })

    const badgeText = new Konva.Text({
      name: 'stack-badge',
      text: String(stack.length),
      fontSize: 9,
      fontFamily: 'Inter, system-ui, sans-serif',
      fill: STACK_BADGE_FG,
      listening: false,
      align: 'center',
      verticalAlign: 'middle',
    })
    // Center text on the badge circle
    badgeText.x(offsetX - badgeText.width() / 2)
    badgeText.y(offsetY - badgeText.height() / 2)

    g.add(bgCircle)
    g.add(badgeText)
  }
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
