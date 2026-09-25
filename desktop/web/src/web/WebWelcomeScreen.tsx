import { useState } from 'preact/hooks'
import { t } from '../i18n'
import { locale } from '../app/settings/state'
import { DraftList } from '../components/shared/DraftList'
import styles from '../components/shared/WelcomeScreen.module.css'
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from './browser-design-session'

interface WebWelcomeScreenProps {
  readonly controller?: BrowserDesignSessionController
}

export function WebWelcomeScreen({
  controller = browserDesignSessionController,
}: WebWelcomeScreenProps) {
  const [drafts, setDrafts] = useState(() => controller.listDrafts())
  return (
    <div
      className={styles.welcome}
      role="region"
      aria-label={t('canvas.emptyWelcome')}
      data-testid="web-welcome-screen"
    >
      <div className={styles.hero}>
        <img
          src={new URL('../assets/canopi-logo.svg', import.meta.url).href}
          className={styles.logo}
          alt="Canopi"
          draggable={false}
        />

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            type="button"
            onClick={() => { void controller.newDesign().catch(logWebWelcomeError) }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('canvas.emptyNewDesign')}
          </button>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={() => { void controller.openCanopi().catch(logWebWelcomeError) }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 13h12M2 4h5l2 2h5v6H2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('canvas.emptyOpenDesign')}
          </button>
        </div>
      </div>

      <DraftList
        drafts={drafts}
        locale={locale.value}
        onOpen={(id) => { void controller.openDraft(id).catch(logWebWelcomeError) }}
        onDelete={(id) => {
          const deleted = controller.deleteDraft(id)
          if (!deleted.ok) logWebWelcomeError(deleted.error)
          setDrafts(controller.listDrafts())
        }}
      />
    </div>
  )
}

function logWebWelcomeError(error: unknown): void {
  console.error('Browser Web welcome command failed:', error)
}
