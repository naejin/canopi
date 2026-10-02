import type { FunctionComponent } from 'preact'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { focusOwner } from '../../app/keyboard/focus-owner'
import { useEnglishFallbackNames } from '../../app/plant-finder/catalog-names'
import { toolCardContent, type SavedStampSummary } from '../../app/tool-card/content'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { readPlantStampSource, type PlantStampSource } from '../../canvas/plant-stamp-source'
import { speciesPlacementAppearance } from '../../canvas/runtime/species-key'
import type { PlantSymbolId } from '../../canvas/runtime/scene'
import {
  readSavedObjectStampName,
  readSavedObjectStampSource,
} from '../../canvas/saved-object-stamp-source'
import {
  currentCanvasQuerySurface,
  currentCanvasTool,
  currentCanvasToolCommandSurface,
  currentCanvasToolGuidance,
} from '../../canvas/session'
import type { CanvasPlantRowGuidance, CanvasToolGuidance } from '../../canvas/session-state'
import { scrollWheel } from '../../app/settings/state'
import { t } from '../../i18n'
import { SpeciesCommonName } from '../shared/SpeciesIdentity'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import { SpeciesChooser } from './SpeciesChooser'
import { ToolIcon } from './toolbar-icons'
import { displayedPlantColor } from '../../app/plant-display/state'
import styles from './ToolCard.module.css'

/** What the tool card hands its stamp chooser (`StampChooser`, Desktop). */
export interface StampChooserProps {
  onChosen(): void
  onEscape(): void
}

/**
 * The tool card, top left beside the tool rail: the tool's name, the live
 * instruction (naming the chosen species or stamp) and quiet key hints that
 * end with what Esc does now. Select shows its name and one quiet line of
 * modifiers. It hides for Pan, in overview and while "Where is your site?" shows. The text is one polite live region that
 * stays mounted, so choosing a tool is announced. Place plants carries the
 * species chooser while no species is chosen, or after Change species; Place a
 * stamp opens its saved stamps with Change stamp; Plant a row carries its
 * spacing field and the row's count once a plant is picked.
 */
export function ToolCard({ stampChooser: StampChooser }: {
  /** Place a stamp's saved-stamp chooser; editions without saved stamps offer none. */
  readonly stampChooser?: FunctionComponent<StampChooserProps>
}) {
  const tool = currentCanvasTool.value
  const guidance = currentCanvasToolGuidance.value
  const source = readPlantStampSource()
  const savedStamp = readSavedStampSummary()
  const overview = currentCanvasQuerySurface.value?.view.mode.value === 'overview'
  const [changingSpecies, setChangingSpecies] = useState(false)
  const species = usePlantStampSpeciesName(source)
  const [choosingStamp, setChoosingStamp] = useState(false)
  const content = siteLocateOpen.value || overview
    ? null
    : toolCardContent({
        tool,
        guidance,
        speciesName: species?.name ?? null,
        savedStamp,
        scrollWheel: scrollWheel.value,
        translate: t,
      })
  const choosing = content?.tool === 'plant-stamp' && (source === null || changingSpecies)
  const lead = content ? cardLead(content.tool, source, guidance) : null
  // Each click on the map with no species chosen points to the chooser again.
  const prompts = useRef(0)
  const lastPrompt = useRef(false)
  if (guidance.promptSpecies && !lastPrompt.current) prompts.current += 1
  lastPrompt.current = guidance.promptSpecies

  const stampChooser = StampChooser && content?.chooser?.kind === 'stamp' ? content.chooser : null

  useEffect(() => {
    if (tool !== 'plant-stamp') setChangingSpecies(false)
    if (tool !== 'object-stamp' && tool !== 'saved-object-stamp') setChoosingStamp(false)
  }, [tool])

  function closeChooser(): void {
    setChangingSpecies(false)
    setChoosingStamp(false)
    // The map takes focus back once a species or stamp is chosen, or the chooser closes.
    focusOwner.focusMap('chooser-closed')
  }

  return (
    <section
      className={content ? styles.card : styles.idle}
      data-tool-card={content?.tool}
      aria-label={content?.title}
    >
      {/* First in the DOM so the title and instruction wrap around it. */}
      {content?.chooser?.kind === 'species' && source && !changingSpecies && (
        <button type="button" className={styles.link} onClick={() => setChangingSpecies(true)}>
          {t('canvas.toolCard.changeSpecies')}
        </button>
      )}
      {stampChooser && !choosingStamp && (
        <button type="button" className={styles.link} onClick={() => setChoosingStamp(true)}>
          {t(stampChooser.held ? 'canvas.toolCard.changeStamp' : 'canvas.toolCard.chooseSavedStamp')}
        </button>
      )}
      <div role="status" aria-live="polite">
        {content && (
          <>
            <span className={styles.title}>
              {lead && <CardLead lead={lead} />}
              {content.title}
            </span>
            {/* The subject takes its own line, so a long name never breaks the instruction. */}
            {content.subject && (
              <b className={styles.subject}>
                {content.tool === 'plant-stamp' && species?.englishFallback
                  ? <SpeciesCommonName name={content.subject} englishFallback />
                  : content.subject}
              </b>
            )}
            {content.instruction && (
              <span className={content.subject ? `${styles.instruction} ${styles.afterSubject}` : styles.instruction}>
                {content.instruction}
              </span>
            )}
            {guidance.plantRow?.phase === 'row' && <SpacingField row={guidance.plantRow} />}
            {content.rowCount && (
              // Moves with every pointer move, so it is not announced.
              <span className={styles.count} aria-live="off" data-plant-spacing-generated-count data-density={content.rowCount.density}>
                {content.rowCount.text}
              </span>
            )}
            <span className={styles.hints}>{content.hints}</span>
          </>
        )}
      </div>
      {choosing && (
        <SpeciesChooser
          autoFocus={changingSpecies}
          focusRequest={prompts.current}
          onChosen={closeChooser}
          onEscape={closeChooser}
        />
      )}
      {StampChooser && stampChooser && choosingStamp && <StampChooser onChosen={closeChooser} onEscape={closeChooser} />}
    </section>
  )
}

/**
 * The chosen species as the card names it: its name in the interface language, else
 * its English catalog name marked "(en)" (from the runtime for Design species, from
 * the catalog for the others), else the name saved with the source, else the
 * scientific name.
 */
function usePlantStampSpeciesName(source: PlantStampSource | null): { name: string; englishFallback: boolean } | null {
  const queries = currentCanvasQuerySurface.value
  void queries?.revision.plantNames.value
  const catalogEnglish = useEnglishFallbackNames(source && !source.common_name
    ? [{ canonicalName: source.canonical_name, commonName: null }]
    : NO_SPECIES)
  if (!source) return null
  const canonicalName = source.canonical_name
  const localized = queries?.getLocalizedCommonNames().get(canonicalName)
  if (localized) return { name: localized, englishFallback: false }
  const runtimeEnglish = queries?.getEnglishFallbackNames().get(canonicalName)
  if (runtimeEnglish) return { name: runtimeEnglish, englishFallback: true }
  if (source.common_name) return { name: source.common_name, englishFallback: false }
  const english = catalogEnglish.get(canonicalName)
  return english ? { name: english, englishFallback: true } : { name: canonicalName, englishFallback: false }
}

const NO_SPECIES: readonly { canonicalName: string }[] = []

type Lead = { readonly kind: 'species'; readonly symbol: PlantSymbolId; readonly color: string } | { readonly kind: 'stamp' }

/** The glyph at the start of the card: the species a click places or a row repeats, or the stamp. */
function cardLead(tool: string, source: PlantStampSource | null, guidance: CanvasToolGuidance): Lead | null {
  if (tool === 'plant-stamp' && source) {
    const scene = currentCanvasQuerySurface.value?.getSceneSnapshot()
    const appearance = speciesPlacementAppearance(
      scene ?? { plantSpeciesSymbols: {}, plantSpeciesColors: {} },
      { canonicalName: source.canonical_name, stratum: source.stratum },
    )
    return { kind: 'species', ...appearance, color: displayedPlantColor(appearance.color, source.canonical_name) }
  }
  if (tool === 'plant-spacing' && guidance.plantRow?.glyph) return { kind: 'species', ...guidance.plantRow.glyph }
  if ((tool === 'object-stamp' && guidance.stamp) || tool === 'saved-object-stamp') return { kind: 'stamp' }
  return null
}

function CardLead({ lead }: { readonly lead: Lead }) {
  if (lead.kind === 'stamp') {
    return <span className={styles.lead} aria-hidden="true" data-tool-card-lead="stamp"><ToolIcon name="object-stamp" /></span>
  }
  return (
    <span className={styles.lead} aria-hidden="true" data-tool-card-lead="species" style={{ color: lead.color }}>
      <PlantSymbolGlyph symbol={lead.symbol} size={22} />
    </span>
  )
}

/**
 * Plant a row's spacing: the runtime keeps the text and parses it; Enter keeps
 * a valid spacing and gives the map focus back, Esc drops the picked plant,
 * and leaving the field keeps a valid spacing without moving focus.
 */
function SpacingField({ row }: { readonly row: CanvasPlantRowGuidance }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const focused = useRef(0)
  const field = currentCanvasToolCommandSurface.value?.plantRowSpacing

  useLayoutEffect(() => {
    if (row.focusRequest === focused.current) return
    focused.current = row.focusRequest
    input.current?.focus({ preventScroll: true })
  }, [row.focusRequest])

  return (
    <span className={styles.field}>
      <label className={styles.fieldLabel} for={id}>{t('canvas.plantSpacing.interval')}</label>
      <input
        ref={input}
        id={id}
        className={styles.fieldInput}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellcheck={false}
        value={row.interval}
        aria-invalid={!row.intervalValid}
        data-plant-spacing-interval-input
        onInput={(event) => field?.input(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return
          if (event.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Enter') field?.commit(event.currentTarget.value)
          else field?.cancel()
        }}
        onBlur={(event) => field?.blur(event.currentTarget.value)}
      />
    </span>
  )
}

function readSavedStampSummary(): SavedStampSummary | null {
  const payload = readSavedObjectStampSource()
  if (!payload) return null
  return {
    name: readSavedObjectStampName(),
    plants: payload.plants.length,
    species: new Set(payload.plants.map((plant) => plant.canonicalName)).size,
  }
}
