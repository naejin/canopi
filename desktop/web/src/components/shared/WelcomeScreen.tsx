import { useState, useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { newDesignAction, openDesign, openDesignFromPath } from '../../state/document'
import { getRecentFiles } from '../../ipc/design'
import type { DesignSummary } from '../../types/design'
import styles from './WelcomeScreen.module.css'

export function WelcomeScreen() {
  void locale.value

  const [recentFiles, setRecentFiles] = useState<DesignSummary[]>([])

  useEffect(() => {
    getRecentFiles()
      .then((files) => setRecentFiles(files.slice(0, 5)))
      .catch(() => {})
  }, [])

  return (
    <div className={styles.welcome} role="region" aria-label={t('canvas.emptyWelcome')}>
      <div className={styles.hero}>
        <img
          src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
          className={styles.logo}
          alt="Canopi"
          draggable={false}
        />

        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            type="button"
            onClick={() => { void newDesignAction() }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('canvas.emptyNewDesign')}
          </button>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={() => { void openDesign() }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 13h12M2 4h5l2 2h5v6H2V4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('canvas.emptyOpenDesign')}
          </button>
        </div>
      </div>

      {recentFiles.length > 0 && (
        <div className={styles.recentSection}>
          <h2 className={styles.recentTitle}>{t('canvas.emptyRecentFiles')}</h2>
          <ul className={styles.recentList}>
            {recentFiles.map((file) => (
              <li key={file.path}>
                <button
                  className={styles.recentItem}
                  type="button"
                  onClick={() => { void openDesignFromPath(file.path) }}
                  title={file.path}
                >
                  <svg className={styles.recentIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 5h6M5 8h6M5 11h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  </svg>
                  <div className={styles.recentInfo}>
                    <span className={styles.recentName}>{file.name}</span>
                    <span className={styles.recentMeta}>
                      {formatDate(file.updated_at, locale.value)}
                      {file.plant_count > 0 && ` · ${file.plant_count} plants`}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string, lang: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 7) {
      const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
      return rtf.format(-diffDays, 'day')
    }
    return d.toLocaleDateString(lang)
  } catch {
    return ''
  }
}
