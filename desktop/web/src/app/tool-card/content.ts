import type { CanvasStampGuidance, CanvasToolGuidance } from '../../canvas/session-state'

type Translate = (key: string, options?: Readonly<Record<string, unknown>>) => string

/** A saved stamp armed from Favorites, as the card names it. */
export interface SavedStampSummary {
  readonly name: string | null
  readonly plants: number
  readonly species: number
}

export interface ToolCardInput {
  readonly tool: string
  readonly guidance: CanvasToolGuidance
  /** Place plants: the chosen species' shown name, or null while the card offers its chooser. */
  readonly speciesName: string | null
  readonly savedStamp: SavedStampSummary | null
  readonly translate: Translate
}

/**
 * What the tool card says: the tool's name, the live instruction (its subject,
 * such as the species or stamp, shown first and bold) and quiet key hints that
 * end with what Esc does now.
 */
export interface ToolCardContent {
  readonly tool: string
  readonly title: string
  readonly subject: string | null
  readonly instruction: string
  readonly hints: string
  /** Place plants offers Change species. */
  readonly changeSpecies: boolean
  /** Plant a row: how many plants the drawn row adds, and how dense it is. */
  readonly rowCount: { readonly text: string; readonly density: 'normal' | 'dense' | 'blocked' } | null
}

/** Tools without a card: Select and Pan need no guidance. */
const NO_CARD = new Set(['select', 'hand'])

const TITLE_KEYS: Readonly<Record<string, string>> = {
  'plant-stamp': 'canvas.tools.plantStamp',
  'plant-spacing': 'canvas.tools.plantSpacing',
  'object-stamp': 'canvas.tools.objectStamp',
  'saved-object-stamp': 'canvas.tools.objectStamp',
  polygon: 'canvas.tools.polygon',
  rectangle: 'canvas.tools.rectangle',
  ellipse: 'canvas.tools.ellipse',
  line: 'canvas.tools.line',
  text: 'canvas.tools.text',
  'measurement-guide': 'canvas.tools.measurementGuide',
}

const PLACING_TOOLS = new Set(['plant-stamp', 'object-stamp', 'saved-object-stamp'])

export function toolCardContent(input: ToolCardInput): ToolCardContent | null {
  const { tool, guidance, translate } = input
  const titleKey = TITLE_KEYS[tool]
  if (NO_CARD.has(tool) || !titleKey) return null

  const esc = translate(
    guidance.gesture ? 'canvas.toolCard.escCancel'
      : PLACING_TOOLS.has(tool) ? 'canvas.toolCard.escStopPlacing'
        : 'canvas.toolCard.escSelect',
  )
  const hints = (...keys: string[]): string => [...keys.map((key) => translate(key)), esc].join(' · ')
  const card = (subject: string | null, instruction: string, hintText = hints()): ToolCardContent => ({
    tool,
    title: translate(titleKey),
    subject,
    instruction,
    hints: hintText,
    changeSpecies: tool === 'plant-stamp',
    rowCount: null,
  })

  switch (tool) {
    case 'plant-stamp':
      return input.speciesName
        ? card(input.speciesName, translate('canvas.toolCard.placeOne'))
        : card(null, translate(guidance.promptSpecies ? 'canvas.toolCard.chooseFirst' : 'canvas.toolCard.chooseSpecies'))
    case 'object-stamp':
      return guidance.stamp
        ? card(stampName(guidance.stamp, translate), stampInstruction(guidance.stamp, translate))
        : card(null, translate('canvas.toolCard.stampPick'))
    case 'saved-object-stamp': {
      const stamp = input.savedStamp
      return card(stamp?.name ?? null, stamp ? stampInstruction(stamp, translate) : translate('canvas.toolCard.stampPlace'))
    }
    case 'plant-spacing': {
      const row = guidance.plantRow
      if (row?.phase !== 'row') {
        return card(null, translate(row?.phase === 'missed' ? 'canvas.plantSpacing.sourceMissed' : 'canvas.plantSpacing.selectSource'))
      }
      const counted = translate('canvas.plantSpacing.generatedCount', { count: row.count ?? 0 })
      return {
        ...card(row.plantName, translate('canvas.plantSpacing.dragAlong'), hints('canvas.toolCard.rowKeys')),
        rowCount: row.count === null ? null : {
          text: row.density === 'blocked' ? `${counted} · ${translate('canvas.plantSpacing.commitLimitWarning')}` : counted,
          density: row.density,
        },
      }
    }
    case 'polygon':
      return card(null, translate('canvas.toolCard.polygon'), hints('canvas.toolCard.polygonKeys'))
    case 'rectangle':
      return card(null, translate('canvas.toolCard.rectangle'))
    case 'ellipse':
      return card(null, translate('canvas.toolCard.ellipse'))
    case 'line':
      return card(null, translate('canvas.toolCard.line'))
    case 'text':
      return guidance.gesture
        ? card(null, translate('canvas.toolCard.textType'), hints('canvas.toolCard.textKeys'))
        : card(null, translate('canvas.toolCard.textPlace'))
    case 'measurement-guide':
      return card(null, translate('canvas.toolCard.measure'))
    default:
      return null
  }
}

function stampName(stamp: CanvasStampGuidance, translate: Translate): string {
  if (stamp.name) return stamp.name
  if (stamp.kind === 'zone') return translate('canvas.toolCard.stampZone')
  if (stamp.kind === 'annotation') return translate('canvas.tools.text')
  return translate('canvas.toolCard.stampGroup')
}

/** "10 plants · 4 species · click to place", counts only when the stamp has plants. */
function stampInstruction(stamp: Pick<CanvasStampGuidance, 'plants' | 'species'>, translate: Translate): string {
  const parts: string[] = []
  if (stamp.plants > 1) {
    parts.push(translate('canvas.toolCard.plants', { count: stamp.plants }))
    parts.push(translate('canvas.toolCard.species', { count: stamp.species }))
  }
  parts.push(translate('canvas.toolCard.stampPlace'))
  return parts.join(' · ')
}
