import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import { usePlantFinder } from '../../app/plant-finder/use-plant-finder'
import type { PlantFinderHit } from '../../app/plant-finder/matcher'
import { selectPanel } from '../../app/shell/state'
import {
  recentPlantStampSources,
  selectPlantStampSource,
  type PlantStampSource,
} from '../../canvas/plant-stamp-source'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'
import { MatchText, PlantFinder } from '../shared/PlantFinder'
import styles from './ToolCard.module.css'

type SectionId = 'design' | 'favorites' | 'recent'

interface ChooserSpecies extends PlantStampSource {
  readonly section: SectionId
}

const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  design: 'canvas.toolCard.inDesign',
  favorites: 'canvas.toolCard.favorites',
  recent: 'canvas.toolCard.recent',
}

/**
 * Place plants' compact species chooser in the tool card: the species in this
 * Design first, then Favorites, then recent picks, narrowed by the shared plant
 * finder, with the full catalog one link away. Choosing sets the plant stamp
 * source; the card then says what a click places.
 */
export function SpeciesChooser({ autoFocus, focusRequest, onChosen, onEscape }: {
  /** Focus the search field on mount (Change species). */
  readonly autoFocus: boolean
  /** Changes when the card should point the user here again (a click with no species). */
  readonly focusRequest: number
  onChosen(): void
  onEscape(): void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const species = useChooserSpecies()
  const finder = usePlantFinder(species.map(toFinderSpecies), query)
  const listId = 'tool-card-species-options'

  useEffect(() => {
    const view = speciesCatalogWorkbench.favorites.peek()
    if (view.items.length === 0 && !view.loading) void speciesCatalogWorkbench.loadFavorites()
  }, [])
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    if (focusRequest > 0) input.current?.focus()
  }, [focusRequest])

  function choose(entry: ChooserSpecies): void {
    selectPlantStampSource(entry)
    onChosen()
  }

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (query) setQuery('')
    else onEscape()
  }

  const bySpecies = new Map(species.map((entry) => [entry.canonical_name, entry]))
  const matches: readonly { entry: ChooserSpecies, hit: PlantFinderHit<string> | null }[] = finder.active
    ? finder.hits.flatMap((hit) => {
        const entry = bySpecies.get(hit.key)
        return entry ? [{ entry, hit }] : []
      })
    : species.map((entry) => ({ entry, hit: null }))

  return (
    <div className={styles.chooser}>
      <PlantFinder
        value={query}
        onChange={setQuery}
        inputRef={input}
        onKeyDown={handleKeyDown}
        controls={listId}
        correction={finder.correction}
      />
      <div id={listId} className={styles.options}>
        {finder.active
          ? <OptionList entries={matches} onChoose={choose} />
          : (['design', 'favorites', 'recent'] as const).map((section) => {
              const entries = matches.filter(({ entry }) => entry.section === section)
              if (entries.length === 0) return null
              return (
                <section key={section} data-species-section={section} aria-label={t(SECTION_LABELS[section])}>
                  <h3 className={styles.section}>{t(SECTION_LABELS[section])}</h3>
                  <OptionList entries={entries} onChoose={choose} />
                </section>
              )
            })}
        {matches.length === 0 && (
          <p className={styles.empty}>
            {finder.active ? t('canvas.toolCard.noMatch', { query: query.trim() }) : t('canvas.toolCard.noSpecies')}
          </p>
        )}
      </div>
      <button type="button" className={styles.catalogLink} onClick={() => selectPanel('plant-db')}>
        {t('canvas.toolCard.openCatalog')}
      </button>
    </div>
  )
}

function OptionList({ entries, onChoose }: {
  readonly entries: readonly { entry: ChooserSpecies, hit: PlantFinderHit<string> | null }[]
  onChoose(entry: ChooserSpecies): void
}) {
  return (
    <ul className={styles.optionList}>
      {entries.map(({ entry, hit }) => {
        const common = entry.common_name
        const marks = (text: string) => hit?.marks.find((mark) => mark.text === text)?.ranges ?? []
        return (
          <li key={entry.canonical_name}>
            <button
              type="button"
              className={styles.option}
              data-species-option={entry.canonical_name}
              onClick={() => onChoose(entry)}
            >
              {common && <span className={styles.optionName}><MatchText text={common} ranges={marks(common)} /></span>}
              <i lang="la" className={styles.optionLatin}><MatchText text={entry.canonical_name} ranges={marks(entry.canonical_name)} /></i>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function toFinderSpecies(entry: ChooserSpecies) {
  return { canonicalName: entry.canonical_name, commonName: entry.common_name }
}

/** Design species (most planted first), then Favorites, then recent picks, each species once. */
function useChooserSpecies(): readonly ChooserSpecies[] {
  const queries = currentCanvasQuerySurface.value
  const sceneRevision = queries?.revision.scene.value
  const namesRevision = queries?.revision.plantNames.value
  const favoriteItems = speciesCatalogWorkbench.favorites.value.items
  const recent = recentPlantStampSources.value
  const design = useMemo(() => designSpecies(), [queries, sceneRevision, namesRevision])
  return useMemo(() => {
    const seen = new Set<string>()
    const entries: ChooserSpecies[] = []
    const add = (source: PlantStampSource, section: SectionId) => {
      if (seen.has(source.canonical_name)) return
      seen.add(source.canonical_name)
      entries.push({ ...source, section })
    }
    for (const source of design) add(source, 'design')
    for (const item of favoriteItems) {
      add({
        canonical_name: item.canonical_name,
        common_name: item.common_name,
        stratum: item.stratum,
        width_max_m: item.width_max_m,
      }, 'favorites')
    }
    for (const source of recent) add(source, 'recent')
    return entries
  }, [design, favoriteItems, recent])
}

function designSpecies(): readonly PlantStampSource[] {
  const queries = currentCanvasQuerySurface.peek()
  if (!queries) return []
  const names = queries.getLocalizedCommonNames()
  const bySpecies = new Map<string, { source: PlantStampSource, count: number }>()
  for (const plant of queries.getSceneSnapshot().plants) {
    const current = bySpecies.get(plant.canonicalName)
    if (current) {
      current.count += 1
      continue
    }
    bySpecies.set(plant.canonicalName, {
      count: 1,
      source: {
        canonical_name: plant.canonicalName,
        common_name: names.get(plant.canonicalName) ?? plant.commonName,
        stratum: plant.stratum,
        // The width the catalog gave when the species was placed.
        width_max_m: plant.canopySpreadM,
      },
    })
  }
  return [...bySpecies.values()]
    .sort((left, right) => right.count - left.count
      || (left.source.common_name ?? left.source.canonical_name).localeCompare(right.source.common_name ?? right.source.canonical_name))
    .map((entry) => entry.source)
}
