import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  currentCanvasQuerySurface,
  currentCanvasSpeciesFocusCommands,
} from '../../canvas/session'
import { buildSpeciesKey } from '../../canvas/runtime/species-key'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from '../canvas/PlantSymbolGlyph'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import { SpeciesIdentity } from '../shared/SpeciesIdentity'
import { SurfaceSearch } from '../shared/SurfaceSearch'
import { speciesCatalogWorkbench } from '../../app/plant-browser'
import styles from './SpeciesKeyPanel.module.css'

export function SpeciesKeyPanel({ renderDetail }: { renderDetail?: (canonicalName: string) => ComponentChildren }) {
  const [openedDetail, setOpenedDetail] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const wasShowingDetail = useRef(false)
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value
  const showingDetail = Boolean(selected && selected === openedDetail && renderDetail)
  useLayoutEffect(() => {
    if (wasShowingDetail.current && !showingDetail) {
      const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-species-detail]') ?? []
      Array.from(buttons).find(button => button.dataset.speciesDetail === openedDetail)?.focus()
    }
    wasShowingDetail.current = showingDetail
  }, [showingDetail, openedDetail])
  const [search, setSearch] = useState('')
  const queries = currentCanvasQuerySurface.value
  const revision = queries?.revision.scene.value
  const namesRevision = queries?.revision.plantNames.value
  const entries = useMemo(
    () =>
      queries
        ? buildSpeciesKey(
            queries.getSceneSnapshot(),
            queries.getLocalizedCommonNames(),
          )
        : [],
    [queries, revision, namesRevision],
  )
  const focus = queries?.getSpeciesFocus()
  const needle = normalizeSearch(search)
  const visible = entries.filter((entry) =>
    normalizeSearch(
      `${entry.code} ${entry.canonicalName} ${entry.commonName ?? ''}`,
    ).includes(needle),
  )
  return (
    <section ref={panelRef} className={styles.panel} aria-label={t('speciesKey.title')}>
      {selected && selected === openedDetail && renderDetail ? renderDetail(selected) : <>
      <DockPanelHeader title={t('speciesKey.title')} count={entries.length} />
      <div className={styles.controls}>
        <SurfaceSearch value={search} onChange={setSearch} label={t('speciesKey.search')} />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={focus?.showCodes ?? false}
            onChange={(event) =>
              currentCanvasSpeciesFocusCommands.value?.showCodes(
                event.currentTarget.checked,
              )
            }
          />
          {t('speciesKey.showCodes')}
        </label>
        <div className={styles.summary}>
          <span>{t('savedObjectStamps.summaryPlantOther', { count: entries.reduce((total, entry) => total + entry.count, 0) })}</span>
          {focus?.canonicalName && (
            <button
              type="button"
              onClick={() =>
                currentCanvasSpeciesFocusCommands.value?.focus(null)
              }
            >
              {t('speciesKey.clear')}
            </button>
          )}
        </div>
      </div>
      {visible.length > 0 && <ul className={styles.list}>
        {visible.map((entry) => (
          <li key={entry.canonicalName} className={styles.row}>
            <button
              type="button"
              className={styles.entry}
              aria-pressed={focus?.canonicalName === entry.canonicalName}
              onClick={() =>
                currentCanvasSpeciesFocusCommands.value?.focus(
                  focus?.canonicalName === entry.canonicalName
                    ? null
                    : entry.canonicalName,
                )
              }
            >
              <SpeciesIdentity commonName={entry.commonName} canonicalName={entry.canonicalName} mark={
                entry.appearances.map(appearance => <span key={appearance.color + appearance.symbol} style={{ color: appearance.color }}>
                  <PlantSymbolGlyph symbol={appearance.symbol} size={20} />
                </span>)
              } />
              <span className={styles.code}>{entry.code}</span>
              <span className={styles.count}>{entry.count}</span>
            </button>
            {renderDetail && <button type="button" className={styles.details} data-species-detail={entry.canonicalName}
              aria-label={t('speciesKey.details', { name: entry.commonName || entry.canonicalName })}
              onClick={() => { setOpenedDetail(entry.canonicalName); speciesCatalogWorkbench.selectSpecies(entry.canonicalName) }}>›</button>}
          </li>
        ))}
      </ul>}
      {visible.length === 0 && (
        <p className={styles.empty}>
          {t(entries.length ? 'speciesKey.noResults' : 'speciesKey.empty')}
        </p>
      )}
      </>}
    </section>
  )
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}
