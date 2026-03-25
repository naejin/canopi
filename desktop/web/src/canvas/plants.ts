import Konva from 'konva'
import { getCommonNames } from '../ipc/species'

// Strata color map — raw hex values required; Konva cannot read CSS vars.
const STRATA_COLORS: Record<string, string> = {
  'Emergent':     '#1B5E20',
  'High canopy':  '#2E7D32',
  'Low canopy':   '#388E3C',
  'Understory':   '#558B2F',
  'Shrub':        '#7CB342',
  'Herbaceous':   '#C0CA33',
  'Ground cover': '#D4A843',
  'Vine':         '#7B1FA2',
  'Root':         '#6D4C41',
}
const DEFAULT_PLANT_COLOR = '#4CAF50'

// All plant circles use a fixed screen-pixel radius for maximum readability.
// Real canopy spread visualization is a Phase 3 toggle ("Display: Canopy spread").
const CIRCLE_SCREEN_PX = 8       // radius in screen pixels — consistent for all plants
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
  // At 4.6 px/m (default 100m view): icon+label
  // At 1 px/m: icon only (labels would overlap)
  // At <0.5 px/m: dots only
  if (stageScale < 0.5) return 'dot'
  if (stageScale < 2) return 'icon'
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

  // Genus abbreviation: "Lavandula angustifolia" → "L. ang."
  const parts = opts.canonicalName.split(' ')
  const abbreviation =
    parts.length >= 2
      ? `${parts[0]![0]}. ${parts[1]!.slice(0, 3)}.`
      : opts.canonicalName.slice(0, 6)

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
    fill: '#444444',
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
      fill: '#888888',
      listening: false,
      name: 'plant-botanical',
    })
    botLabel.offsetX(botLabel.width() / 2)
    botLabel.y(CIRCLE_SCREEN_PX + LABEL_GAP + LABEL_FONT_SIZE + 2)
    group.add(botLabel)
  }

  return group
}

/**
 * Update all plant nodes for the current zoom level:
 * - Labels counter-scaled to constant screen size
 * - LOD: hide labels at far zoom, show at close zoom
 * - Minimum circle visual size enforced
 *
 * Called after zoom changes (debounced 150ms).
 */
export function updatePlantsLOD(
  plantsLayer: Konva.Layer,
  lod: PlantLOD,
  stageScale: number,
): void {
  const inv = 1 / stageScale

  plantsLayer.find('.plant-group').forEach((node: Konva.Node) => {
    const g = node as Konva.Group

    // Counter-scale the GROUP — all children (circle, labels) inherit the
    // scale automatically. This is the only per-plant operation needed on zoom.
    g.scale({ x: inv, y: inv })

    // LOD: toggle label visibility based on zoom level
    const label = g.findOne('.plant-label') as Konva.Text | undefined
    const botLabel = g.findOne('.plant-botanical') as Konva.Text | undefined

    if (lod === 'dot') {
      if (label) label.visible(false)
      if (botLabel) botLabel.visible(false)
    } else {
      if (label) label.visible(true)
      if (botLabel) botLabel.visible(lod === 'icon+label')
    }
  })
  plantsLayer.batchDraw()
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

    const parts = canonical.split(' ')
    const abbreviation = parts.length >= 2
      ? `${parts[0]![0]}. ${parts[1]!.slice(0, 3)}.`
      : canonical.slice(0, 6)

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
        fill: '#888888',
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
