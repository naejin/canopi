import { locale } from '../app/settings/state'
import { t } from '../i18n'
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
  void locale.value

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
    </div>
  )
}

function logWebWelcomeError(error: unknown): void {
  console.error('Browser Web welcome command failed:', error)
}
