import { useMemo, useState } from 'preact/hooks'
import {
  currentCanvasQuerySurface,
  currentCanvasSpeciesFocusCommands,
} from '../../canvas/session'
import { buildSpeciesKey } from '../../canvas/runtime/species-key'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from '../canvas/PlantSymbolGlyph'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import styles from './SpeciesKeyPanel.module.css'

export function SpeciesKeyPanel() {
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
    <section className={styles.panel} aria-label={t('speciesKey.title')}>
      <DockPanelHeader title={t('speciesKey.title')} />
      <div className={styles.controls}>
        <p className={styles.hint}>{t('speciesKey.description')}</p>
        <input
          type="search"
          className={styles.search}
          value={search}
          aria-label={t('speciesKey.search')}
          placeholder={t('speciesKey.search')}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
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
          <span>{t('speciesKey.count', { count: entries.length })}</span>
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
      <ul className={styles.list}>
        {visible.map((entry) => (
          <li key={entry.canonicalName}>
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
              <span className={styles.code}>{entry.code}</span>
              <span className={styles.appearances} aria-hidden="true">
                {entry.appearances.map((appearance) => (
                  <span style={{ color: appearance.color }}>
                    <PlantSymbolGlyph symbol={appearance.symbol} size={20} />
                  </span>
                ))}
              </span>
              <span className={styles.names}>
                <span>{entry.commonName || entry.canonicalName}</span>
                {entry.commonName && (
                  <span className={styles.canonical}>
                    {entry.canonicalName}
                  </span>
                )}
              </span>
              <span className={styles.count}>{entry.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && (
        <p className={styles.empty}>
          {t(entries.length ? 'speciesKey.noResults' : 'speciesKey.empty')}
        </p>
      )}
      <p className={styles.footer}>{t('speciesKey.detailHint')}</p>
    </section>
  )
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}
