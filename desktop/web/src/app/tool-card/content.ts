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
  /** Settings › Canvas › Pointing device (stored scroll_wheel: 'zoom' is Mouse, 'pan' is Trackpad): Select's line says
   *  how this device pans and zooms. */
  readonly scrollWheel: 'zoom' | 'pan'
  /** A coarse primary pointer (a touch screen): Select's line names two fingers and a pinch, as for a trackpad. */
  readonly coarsePointer: boolean
  /** The platform's mod key name (Ctrl, or Cmd on a Mac), for Plant a row's no-snap hint. */
  readonly modKey: string
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
  /** Empty for Select, whose card is its name and one line of hints. */
  readonly instruction: string
  readonly hints: string
  /**
   * The chooser link the card offers: Place plants' species, or Place a stamp's
   * saved stamps (`stamp` names Change stamp once one is held).
   */
  readonly chooser: null | { readonly kind: 'species' } | { readonly kind: 'stamp'; readonly held: boolean }
  /** Plant a row: how many plants the drawn row adds, and how dense it is. */
  readonly rowCount: { readonly text: string; readonly density: 'normal' | 'dense' | 'blocked' } | null
}

const TITLE_KEYS: Readonly<Record<string, string>> = {
  select: 'canvas.tools.select',
  // Pan is off the main rail, so its card says what it does.
  hand: 'canvas.tools.hand',
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
const STAMP_TOOLS = new Set(['object-stamp', 'saved-object-stamp'])

export function toolCardContent(input: ToolCardInput): ToolCardContent | null {
  const { tool, guidance, translate } = input
  const titleKey = TITLE_KEYS[tool]
  if (!titleKey) return null

  // What the next Esc does: drops a held row source or stamp pick first, cancels a draft, then leaves the tool.
  const esc = translate(
    tool === 'plant-spacing' && guidance.plantRow?.phase === 'row' ? 'canvas.toolCard.escClearRow'
      : tool === 'object-stamp' && guidance.stamp ? 'canvas.toolCard.escClearStamp'
        : guidance.gesture ? 'canvas.toolCard.escCancel'
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
    chooser: tool === 'plant-stamp' ? { kind: 'species' }
      : STAMP_TOOLS.has(tool) ? { kind: 'stamp', held: guidance.stamp !== null || (tool === 'saved-object-stamp' && input.savedStamp !== null) }
        : null,
    rowCount: null,
  })
  const angle = guidance.stampRotationDeg ?? 0

  switch (tool) {
    case 'select':
      // No Esc meaning: under Select, Esc only clears the selection.
      return card(null, '', translate(input.scrollWheel === 'pan' || input.coarsePointer ? 'canvas.toolCard.selectHintPan' : 'canvas.toolCard.selectHint'))
    case 'hand':
      return card(null, translate('canvas.toolCard.panHint'))
    case 'plant-stamp':
      return input.speciesName
        ? card(input.speciesName, translate('canvas.toolCard.placeOne'))
        : card(null, translate(guidance.promptSpecies ? 'canvas.toolCard.chooseFirst' : 'canvas.toolCard.chooseSpecies'))
    case 'object-stamp':
      return guidance.stamp
        ? card(stampName(guidance.stamp, translate), stampInstruction(guidance.stamp, angle, translate), hints('canvas.toolCard.stampRotateKeys'))
        : card(null, translate('canvas.toolCard.stampPick'))
    case 'saved-object-stamp': {
      const stamp = input.savedStamp
      return stamp
        ? card(stamp.name, stampInstruction(stamp, angle, translate), hints('canvas.toolCard.stampRotateKeys'))
        : card(null, translate('canvas.toolCard.stampPlace'))
    }
    case 'plant-spacing': {
      const row = guidance.plantRow
      if (row?.phase !== 'row') {
        return card(null, translate(row?.phase === 'missed' ? 'canvas.plantSpacing.sourceMissed' : 'canvas.plantSpacing.selectSource'))
      }
      const counted = translate('canvas.plantSpacing.generatedCount', { count: row.count ?? 0 })
      return {
        ...card(row.plantName, translate('canvas.plantSpacing.dragAlong'),
          [translate('canvas.toolCard.rowKeys', { mod: input.modKey }), esc].join(' · ')),
        rowCount: row.count === null ? null : {
          text: row.density === 'blocked' ? `${counted} · ${translate('canvas.plantSpacing.commitLimitWarning')}` : counted,
          density: row.density,
        },
      }
    }
    case 'polygon':
      return card(null, translate('canvas.toolCard.polygon'), hints('canvas.toolCard.polygonKeys'))
    case 'rectangle':
      return card(null, translate('canvas.toolCard.rectangle'), hints('canvas.toolCard.rectangleKeys'))
    case 'ellipse':
      return card(null, translate('canvas.toolCard.ellipse'), hints('canvas.toolCard.ellipseKeys'))
    case 'line':
      return card(null, translate('canvas.toolCard.line'), hints('canvas.toolCard.lineKeys'))
    case 'text':
      return guidance.gesture
        ? card(null, translate('canvas.toolCard.textType'), hints('canvas.toolCard.textKeys'))
        : card(null, translate('canvas.toolCard.textPlace'))
    case 'measurement-guide':
      return card(null, translate('canvas.toolCard.measure'), hints('canvas.toolCard.lineKeys'))
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

/**
 * "10 plants · 4 species · turned 30° · click to place": counts only when the
 * stamp has plants, the angle only once `[` or `]` has turned it.
 */
function stampInstruction(stamp: Pick<CanvasStampGuidance, 'plants' | 'species'>, angle: number, translate: Translate): string {
  const parts: string[] = []
  if (stamp.plants > 1) {
    parts.push(translate('canvas.toolCard.plants', { count: stamp.plants }))
    parts.push(translate('canvas.toolCard.species', { count: stamp.species }))
  }
  if (angle !== 0) parts.push(translate('canvas.toolCard.stampTurned', { degrees: angle }))
  parts.push(translate('canvas.toolCard.stampPlace'))
  return parts.join(' · ')
}
