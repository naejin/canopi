import { useState } from 'preact/hooks'
import { t } from '../../i18n'
import { ButtonTooltip } from './ButtonTooltip'
import { formatRelativeDate } from './relative-date'
import welcomeStyles from './WelcomeScreen.module.css'
import styles from './draft-list.module.css'

export interface DraftListItem {
  readonly id: string
  readonly name: string
  readonly updatedAt: string
}

interface DraftListProps {
  readonly drafts: readonly DraftListItem[]
  readonly locale: string
  onOpen(id: string): void
  onDelete(id: string): void
}

/** Design Drafts on a welcome screen: open one, or delete it after an inline confirmation. */
export function DraftList({ drafts, locale, onOpen, onDelete }: DraftListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  if (drafts.length === 0) return null

  return (
    <div className={welcomeStyles.recentSection} data-testid="design-drafts">
      <h2 className={welcomeStyles.recentTitle}>{t('drafts.title')}</h2>
      <ul className={welcomeStyles.recentList}>
        {drafts.map((draft) => {
          const name = visibleDraftName(draft.name)
          return (
            <li key={draft.id} className={styles.row}>
              {confirmingId === draft.id ? (
                <div className={styles.confirm} role="group" aria-label={t('drafts.confirmDelete')}>
                  <span className={styles.confirmText}>{t('drafts.confirmDelete')}</span>
                  <button
                    type="button"
                    className={styles.confirmDelete}
                    onClick={() => {
                      setConfirmingId(null)
                      onDelete(draft.id)
                    }}
                  >
                    {t('drafts.confirmDeleteAction')}
                  </button>
                  <button
                    type="button"
                    className={styles.confirmCancel}
                    onClick={() => setConfirmingId(null)}
                  >
                    {t('canvas.file.cancel')}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={welcomeStyles.recentItem}
                    onClick={() => onOpen(draft.id)}
                  >
                    <svg className={welcomeStyles.recentIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5" />
                      <path d="M5 5h6M5 8h4" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                    </svg>
                    <div className={welcomeStyles.recentInfo}>
                      <span className={welcomeStyles.recentName}>{name}</span>
                      <span className={welcomeStyles.recentMeta}>
                        {formatRelativeDate(draft.updatedAt, locale)}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    aria-label={t('drafts.delete', { name })}
                    onClick={() => setConfirmingId(draft.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <ButtonTooltip label={t('drafts.delete', { name })} side="left" />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function visibleDraftName(name: string): string {
  return name && name !== 'Untitled' ? name : t('titleBar.untitledDesign')
}
