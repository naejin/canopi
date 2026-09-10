import { sidePanel } from '../../app/shell/state'
import { t } from '../../i18n'
import styles from './DockPanelHeader.module.css'

export function DockPanelHeader({ title }: { readonly title: string }) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <button
        type="button"
        className={styles.close}
        aria-label={t('sidebar.close')}
        onClick={() => {
          const panel = sidePanel.value
          sidePanel.value = null
          document
            .querySelector<HTMLButtonElement>(`button[data-panel="${panel}"]`)
            ?.focus()
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M6 18 18 6" />
        </svg>
      </button>
    </header>
  )
}
