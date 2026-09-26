import { useId, useState } from 'preact/hooks'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
import { ActionMenu } from './ActionMenu'
import { ControlIcon, type ControlIconName } from './ControlIcon'
import { visibleDesignName } from './DesignNameField'
import { formatRelativeDate } from './relative-date'
import styles from './StartScreen.module.css'

export interface StartScreenAction {
  readonly label: string
  readonly shortcut?: string
  run(): void
}

export interface StartScreenLink extends StartScreenAction {
  readonly icon: ControlIconName
}

export interface StartScreenDesign {
  readonly id: string
  readonly name: string
  readonly plantCount?: number
  readonly updatedAt: string
  open(): void
}

export interface StartScreenDraft {
  readonly id: string
  readonly name: string
  readonly updatedAt: string
  open(): void
  delete(): void
}

interface StartScreenProps {
  readonly newDesign: StartScreenAction
  readonly openDesign: StartScreenAction
  readonly links: readonly StartScreenLink[]
  readonly footer: string
  /** Null when the edition keeps no recent files (Web). */
  readonly recent: readonly StartScreenDesign[] | null
  readonly drafts: readonly StartScreenDraft[]
}

/**
 * The start screen both editions share: purpose and the two ways in on the
 * left; recent Designs and Drafts on the right, searchable. Deleting a Draft
 * confirms inline and names it, because a Draft cannot be recovered.
 */
export function StartScreen({ newDesign, openDesign, links, footer, recent, drafts }: StartScreenProps) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const needle = fold(query.trim())
  const matches = (name: string) => !needle || fold(visibleDesignName(name)).includes(needle)
  const visibleRecent = recent?.filter((design) => matches(design.name)) ?? null
  const visibleDrafts = drafts.filter((draft) => matches(draft.name))
  const nothingMatches = needle !== '' && (visibleRecent?.length ?? 0) === 0 && visibleDrafts.length === 0

  return (
    <div className={styles.start} role="region" aria-label={t('start.region')} data-start-screen>
      <div className={styles.intro}>
        <div className={styles.brand}>
          <img
            src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
            className={styles.logo}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <h1 className={styles.title}>Canopi</h1>
        </div>
        <p className={styles.purpose}>{t('start.purpose')}</p>
        <div className={styles.ways}>
          <button type="button" className={styles.primary} onClick={newDesign.run}>
            <span>{newDesign.label}</span>
            {newDesign.shortcut && <kbd className={styles.key}>{newDesign.shortcut}</kbd>}
          </button>
          <button type="button" className={styles.secondary} onClick={openDesign.run}>
            <span>{openDesign.label}</span>
            {openDesign.shortcut && <kbd className={styles.key}>{openDesign.shortcut}</kbd>}
          </button>
        </div>
        <nav className={styles.links} aria-label={t('start.more')}>
          {links.map((link) => (
            <button key={link.label} type="button" className={styles.link} onClick={link.run}>
              <ControlIcon name={link.icon} />
              {link.label}
            </button>
          ))}
        </nav>
        <p className={styles.footer}>{footer}</p>
      </div>

      <div className={styles.library}>
        <label className={styles.search} htmlFor={searchId}>
          <ControlIcon name="search" />
          <input
            id={searchId}
            type="search"
            className={styles.searchInput}
            value={query}
            placeholder={t('start.searchDesigns')}
            aria-label={t('start.searchDesigns')}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </label>
        {nothingMatches && <p className={styles.empty} role="status">{t('start.noMatches', { query: query.trim() })}</p>}

        {visibleRecent && visibleRecent.length > 0 && (
          <section className={styles.section} aria-labelledby={`${searchId}-recent`}>
            <h2 className={styles.sectionTitle} id={`${searchId}-recent`}>{t('start.recentDesigns')}</h2>
            <ul className={styles.rows}>
              {visibleRecent.map((design) => (
                <li key={design.id} className={styles.row}>
                  <button type="button" className={styles.rowButton} onClick={design.open}>
                    <span className={styles.thumb} aria-hidden="true"><ControlIcon name="pin" size={20} /></span>
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{visibleDesignName(design.name)}</span>
                      {design.plantCount !== undefined && (
                        <span className={styles.rowMeta}>{t('start.plantCount', { plants: new Intl.NumberFormat(locale.value).format(design.plantCount) })}</span>
                      )}
                    </span>
                    <span className={styles.rowDate}>{formatRelativeDate(design.updatedAt, locale.value)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {visibleDrafts.length > 0 && (
          <section className={styles.section} aria-labelledby={`${searchId}-drafts`} data-design-drafts>
            <h2 className={styles.sectionTitle} id={`${searchId}-drafts`}>{t('drafts.title')}</h2>
            <p className={styles.sectionIntro}>{t('drafts.intro')}</p>
            <ul className={styles.rows}>
              {visibleDrafts.map((draft) => <DraftRow key={draft.id} draft={draft} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function DraftRow({ draft }: { readonly draft: StartScreenDraft }) {
  const [confirming, setConfirming] = useState(false)
  const name = visibleDesignName(draft.name)
  return (
    <li className={styles.row}>
      <div className={styles.rowLine}>
        <button type="button" className={styles.rowButton} onClick={draft.open}>
          <span className={`${styles.thumb} ${styles.draftThumb}`} aria-hidden="true"><ControlIcon name="draft" size={20} /></span>
          <span className={styles.rowText}>
            <span className={styles.rowName}>{name}</span>
            <span className={styles.rowMeta}>{t('drafts.neverSaved')}</span>
          </span>
          <span className={styles.rowDate}>{formatRelativeDate(draft.updatedAt, locale.value)}</span>
        </button>
        <ActionMenu
          label={t('drafts.actions', { name })}
          items={[{ label: t('drafts.deleteItem'), danger: true, run: () => setConfirming(true) }]}
        />
      </div>
      {confirming && (
        <div className={styles.confirm} role="alertdialog" aria-label={t('drafts.confirmDelete', { name })}>
          <span className={styles.confirmText}>{t('drafts.confirmDelete', { name })}</span>
          <button type="button" className={styles.secondarySmall} onClick={() => setConfirming(false)} autoFocus>
            {t('canvas.file.cancel')}
          </button>
          <button
            type="button"
            className={styles.danger}
            onClick={() => {
              setConfirming(false)
              draft.delete()
            }}
          >
            {t('drafts.confirmDeleteAction')}
          </button>
        </div>
      )}
    </li>
  )
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}
