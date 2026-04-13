import { getCurrentWindow } from '@tauri-apps/api/window'
import { designName, designDirty } from '../../state/design'
import { activePanel, locale, theme } from '../../app/shell/state'
import { persistCurrentSettings } from '../../app/settings/persistence'
import { t } from '../../i18n'
import { Dropdown, type DropdownItem } from './Dropdown'
import { MenuBar } from './MenuBar'
import styles from './TitleBar.module.css'

const LOCALES = ['en', 'fr', 'es', 'pt', 'it', 'zh', 'de', 'ja', 'ko', 'nl', 'ru'] as const

const LOCALE_ITEMS: DropdownItem<string>[] = LOCALES.map((code) => ({
  value: code,
  label: code.toUpperCase(),
}))

const appWindow = getCurrentWindow()

function LocalePicker() {
  const handleChange = (code: string) => {
    locale.value = code as typeof locale.value
    persistCurrentSettings()
  }

  return (
    <Dropdown
      trigger={locale.value.toUpperCase()}
      items={LOCALE_ITEMS}
      value={locale.value}
      onChange={handleChange}
      menuDirection="down"
      ariaLabel={t('status.language')}
      className={styles.localePicker}
      triggerClassName={styles.localeBtn}
      menuClassName={styles.localeMenu}
      optionClassName={styles.localeItem}
      preserveOverlays
    />
  )
}

export function TitleBar() {
  const showsDocumentName = activePanel.value === 'canvas' || activePanel.value === 'location'
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
    if (target.closest('button, [role="menu"], [role="menubar"], [role="menuitem"]')) return

    if (e.detail === 2) {
      void appWindow.toggleMaximize()
    } else {
      void appWindow.startDragging()
    }
  }

  return (
    <div className={styles.titleBar} onMouseDown={handleMouseDown}>
      {/* Left: Logo + menu bar */}
      <div className={styles.left}>
        <img
          src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
          className={styles.logo}
          alt="Canopi"
          draggable={false}
        />
        <MenuBar />
      </div>

      {/* Center: file name + draggable spacer */}
      <div className={styles.dragRegion}>
        {showsDocumentName && name && name !== 'Untitled' && (
          <span className={styles.fileName}>
            {name}
            {dirty && <span className={styles.dirtyDot} aria-label={t('titleBar.unsavedChanges')} />}
          </span>
        )}
      </div>

      {/* Right controls: language + theme */}
      <div className={styles.settings}>
        <LocalePicker />
        <button
          className={styles.themeBtn}
          onClick={() => {
            theme.value = theme.value === 'dark' ? 'light' : 'dark'
            persistCurrentSettings()
          }}
          aria-label={t('status.theme')}
          title={t(theme.value === 'dark' ? 'theme.light' : 'theme.dark')}
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
