import { useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../app/settings/state'
import {
  designNotebookWorkbench,
  type DesignNotebookWorkbench,
} from '../../app/design-notebook'
import type { DesignSummary } from '../../types/design'
import styles from './DesignNotebookPanel.module.css'

interface DesignNotebookPanelProps {
  readonly workbench?: DesignNotebookWorkbench
}

export function DesignNotebookPanel({
  workbench = designNotebookWorkbench,
}: DesignNotebookPanelProps) {
  const lang = locale.value
  const view = workbench.view.value

  useEffect(() => {
    void workbench.load()
  }, [workbench])

  return (
    <section className={styles.panel} aria-label={t('designNotebook.title')}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>{t('designNotebook.title')}</h2>
          <span className={styles.subtitle}>{t('designNotebook.allDesigns')}</span>
        </div>
        <span className={styles.count} aria-label={t('designNotebook.visibleCount', { count: view.visibleEntries.length })}>
          {view.visibleEntries.length}
        </span>
      </header>

      <div className={styles.searchRegion}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            type="search"
            aria-label={t('designNotebook.searchLabel')}
            placeholder={t('designNotebook.searchPlaceholder')}
            value={view.searchQuery}
            onInput={(event) => {
              workbench.setSearchQuery((event.currentTarget as HTMLInputElement).value)
            }}
          />
          {view.searchQuery.length > 0 && (
            <button
              className={styles.searchClear}
              type="button"
              aria-label={t('designNotebook.clearSearch')}
              onClick={() => workbench.setSearchQuery('')}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={styles.viewStrip} aria-label={t('designNotebook.viewsLabel')}>
        <button className={styles.viewPill} type="button" aria-pressed="true">
          {t('designNotebook.allDesigns')}
        </button>
      </div>

      <div className={styles.list} role="list">
        {view.loading && view.entries.length === 0 ? (
          <div className={styles.feedback}>{t('designNotebook.loading')}</div>
        ) : view.loadError ? (
          <div className={styles.feedback}>{t('designNotebook.loadError')}</div>
        ) : view.entries.length === 0 ? (
          <EmptyState
            title={t('designNotebook.emptyTitle')}
            text={t('designNotebook.emptyText')}
          />
        ) : view.visibleEntries.length === 0 ? (
          <EmptyState
            title={t('designNotebook.noResultsTitle')}
            text={t('designNotebook.noResultsText')}
          />
        ) : (
          view.visibleEntries.map((entry) => (
            <NotebookRow
              key={entry.path}
              entry={entry}
              lang={lang}
              active={entry.path === view.activePath}
              onOpen={() => {
                void workbench.openEntry(entry.path)
              }}
            />
          ))
        )}
      </div>
    </section>
  )
}

function EmptyState({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
    </div>
  )
}

function NotebookRow({
  entry,
  lang,
  active,
  onOpen,
}: {
  readonly entry: DesignSummary
  readonly lang: string
  readonly active: boolean
  readonly onOpen: () => void
}) {
  const date = formatDate(entry.updated_at, lang)

  return (
    <button
      className={`${styles.row}${active ? ` ${styles.rowActive}` : ''}`}
      type="button"
      role="listitem"
      aria-current={active ? 'true' : undefined}
      data-design-path={entry.path}
      onClick={onOpen}
    >
      <span className={styles.rowMain}>
        <span className={styles.rowName}>{entry.name}</span>
        <span className={styles.rowPath}>{entry.path}</span>
      </span>
      <span className={styles.rowMeta}>
        {date}
        {entry.plant_count > 0 && (
          <>
            <span className={styles.metaSeparator} aria-hidden="true">·</span>
            <span>{t('designNotebook.plantCount', { count: entry.plant_count })}</span>
          </>
        )}
      </span>
    </button>
  )
}

function formatDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
