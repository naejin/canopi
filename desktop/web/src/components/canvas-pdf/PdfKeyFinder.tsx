import type { PdfKeyLocation, PdfKeySearch } from '../../app/canvas-pdf/key-finder'
import { plantFinderRangesIn } from '../../app/plant-finder/matcher'
import { t } from '../../i18n'
import { MatchText, PlantFinder } from '../shared/PlantFinder'
import { SpeciesCommonName } from '../shared/SpeciesIdentity'
import styles from './canvas-pdf.module.css'

/** Results shown under the field; the count line says how many species matched. */
const RESULT_LIMIT = 12

/**
 * Find in key: the plant finder over the printed key. Each result names the species
 * and the sheet and page that print it; choosing one (or Enter for the first) opens that
 * page with the entry ringed and scrolled into view.
 */
export function PdfKeyFinder({ query, search, current, sheetName, onQuery, onShow }: {
  readonly query: string
  readonly search: PdfKeySearch
  readonly current: PdfKeyLocation | null
  sheetName(location: PdfKeyLocation): string
  onQuery(query: string): void
  onShow(location: PdfKeyLocation): void
}) {
  return (
    <section className={styles.keyFinder} data-pdf-key-finder aria-label={t('pdf.findInKey')}>
      <PlantFinder
        value={query}
        onChange={onQuery}
        label={t('pdf.findInKey')}
        correction={search.correction}
        summary={search.active && search.results.length > 0 ? t('plantFinder.species', { count: search.speciesCount }) : undefined}
        onKeyDown={(event) => {
          const first = search.results[0]
          if (event.key !== 'Enter' || !first) return
          event.preventDefault()
          onShow(first.location)
        }}
      />
      {search.active && (search.results.length > 0
        ? (
          <ul className={styles.keyResults}>
            {search.results.slice(0, RESULT_LIMIT).map(({ location, hit }) => {
              const { entry } = location
              const common = entry.name !== entry.canonicalName ? entry.name : null
              const chosen = current?.pageId === location.pageId && current.entry.canonicalName === entry.canonicalName
              return (
                <li key={`${location.pageId}:${entry.canonicalName}`}>
                  <button
                    type="button"
                    className={styles.keyResult}
                    data-pdf-key-result
                    aria-current={chosen ? 'true' : undefined}
                    onClick={() => onShow(location)}
                  >
                    <span className={styles.keyResultName}>
                      {common
                        ? <SpeciesCommonName name={<MatchText text={common} ranges={plantFinderRangesIn(hit, common)} />} englishFallback={entry.englishFallback} />
                        : <i lang="la"><MatchText text={entry.canonicalName} ranges={plantFinderRangesIn(hit, entry.canonicalName)} /></i>}
                    </span>
                    {common && (
                      <i lang="la" className={styles.keyResultLatin}>
                        <MatchText text={entry.canonicalName} ranges={plantFinderRangesIn(hit, entry.canonicalName)} />
                      </i>
                    )}
                    <span className={styles.keyResultPlace}>
                      {`${sheetName(location)} · ${t('pdf.pageLabel')} ${location.pageNumber}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
        : <p className={styles.keyEmpty} role="status">{t('plantFinder.noMatches', { query: query.trim() })}</p>)}
    </section>
  )
}
