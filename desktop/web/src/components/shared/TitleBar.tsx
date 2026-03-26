import { getCurrentWindow } from '@tauri-apps/api/window'
import { designName, designDirty } from '../../state/document'
import { activePanel, locale, theme, persistCurrentSettings } from '../../state/app'
import { t } from '../../i18n'
import styles from './TitleBar.module.css'

const LOCALES = ['en', 'fr', 'es', 'pt', 'it', 'zh'] as const

const appWindow = getCurrentWindow()

export function TitleBar() {
  const isCanvas = activePanel.value === 'canvas'
  const name = designName.value
  const dirty = designDirty.value
  // Subscribe to locale so aria-labels re-render on language change
  void locale.value

  // From Tauri docs: use e.buttons === 1 (left button held) and e.detail
  // to distinguish single click (drag) from double click (maximize).
  const handleMouseDown = (e: MouseEvent) => {
    // Only respond to primary (left) button
    if (e.buttons !== 1) return
    // Don't drag if clicking on a window control button
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    if (e.detail === 2) {
      void appWindow.toggleMaximize()
    } else {
      void appWindow.startDragging()
    }
  }

  return (
    <div className={styles.titleBar} onMouseDown={handleMouseDown}>
      {/* Left: Logo + file name */}
      <div className={styles.left}>
        <img
          src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
          className={styles.logo}
          alt="Canopi"
          draggable={false}
        />
        {isCanvas && name && name !== 'Untitled' && (
          <span className={styles.fileName}>
            {dirty && <span className={styles.dirtyDot}>●</span>}
            {name}
          </span>
        )}
      </div>

      {/* Center: Spacer — draggable via parent onMouseDown */}
      <div className={styles.dragRegion} />

      {/* Right controls: language + theme */}
      <div className={styles.settings}>
        <select
          className={styles.langSelect}
          value={locale.value}
          onChange={(e) => {
            locale.value = (e.target as HTMLSelectElement).value as typeof locale.value
            persistCurrentSettings()
          }}
          aria-label={t('status.language')}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>{code.toUpperCase()}</option>
          ))}
        </select>
        <button
          className={styles.themeBtn}
          onClick={() => {
            theme.value = theme.value === 'dark' ? 'light' : 'dark'
            persistCurrentSettings()
          }}
          aria-label={t('status.theme')}
          title={theme.value === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {theme.value === 'dark' ? (
              <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
            ) : (
              <path d="M13 8.5a5.5 5.5 0 0 1-7.5-7.5 6 6 0 1 0 7.5 7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Window controls */}
      <div className={styles.controls}>
        <button
          className={styles.controlBtn}
          onClick={() => void appWindow.minimize()}
          aria-label={t('window.minimize')}
          tabIndex={-1}
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => void appWindow.toggleMaximize()}
          aria-label={t('window.maximize')}
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={() => void appWindow.close()}
          aria-label={t('window.close')}
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
