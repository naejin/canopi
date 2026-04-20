import { useEffect, useRef } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { settingsModalOpen, settingsModalSection, setSettingsModalSection } from '../../app/settings/modal-state'
import {
  cancelSettingsSession,
  canSaveSettingsDraft,
  isSettingsDraftStale,
  saveSettingsSession,
  settingsDraft,
  settingsSavePending,
  updateCurrentDesignDraft,
  updatePreferencesDraft,
} from '../../app/settings/controller'
import type { SettingsSection } from '../../app/settings/modal-state'
import { updaterControlsVisible } from '../../app/updater/config'
import styles from './SettingsModal.module.css'

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  zh: '中文',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  ru: 'Русский',
}

const SECTIONS: Array<{ id: SettingsSection; titleKey: string; summaryKey: string }> = [
  { id: 'preferences', titleKey: 'settings.preferences', summaryKey: 'settings.preferencesSummary' },
  { id: 'currentDesign', titleKey: 'settings.currentDesign', summaryKey: 'settings.currentDesignSummary' },
]

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'))
}

function PreferencesSection() {
  const draft = settingsDraft.value
  if (!draft) return null

  return (
    <div className={styles.sectionBody}>
      <header className={styles.sectionIntro}>
        <h3 className={styles.sectionTitle}>{t('settings.preferences')}</h3>
      </header>

      <section className={styles.group}>
        <header className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{t('settings.theme')}</h3>
        </header>
        <div className={styles.segmented}>
          <button
            type="button"
            className={`${styles.segment} ${draft.preferences.theme === 'light' ? styles.segmentActive : ''}`}
            onClick={() => updatePreferencesDraft('theme', 'light')}
            aria-pressed={draft.preferences.theme === 'light'}
          >
            {t('theme.light')}
          </button>
          <button
            type="button"
            className={`${styles.segment} ${draft.preferences.theme === 'dark' ? styles.segmentActive : ''}`}
            onClick={() => updatePreferencesDraft('theme', 'dark')}
            aria-pressed={draft.preferences.theme === 'dark'}
          >
            {t('theme.dark')}
          </button>
        </div>
      </section>

      <section className={styles.group}>
        <header className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{t('status.language')}</h3>
        </header>
        <label className={`${styles.field} ${styles.compactField}`}>
          <select
            className={`${styles.select} ${styles.compactSelect}`}
            value={draft.preferences.locale}
            onChange={(e) => {
              updatePreferencesDraft('locale', (e.target as HTMLSelectElement).value as typeof draft.preferences.locale)
            }}
          >
            {Object.entries(LOCALE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
      </section>

      {updaterControlsVisible && (
        <>
          <section className={styles.group}>
            <header className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>{t('settings.checkUpdates')}</h3>
              <p className={styles.groupHint}>{t('settings.checkUpdatesHint')}</p>
            </header>
            <label className={styles.checkboxRow}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={draft.preferences.checkUpdatesEnabled}
                onChange={(e) => {
                  updatePreferencesDraft('checkUpdatesEnabled', (e.target as HTMLInputElement).checked)
                }}
              />
              <span className={styles.checkboxLabel}>{t('settings.checkUpdates')}</span>
            </label>
          </section>

          <section className={styles.group}>
            <header className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>{t('updater.channelLabel')}</h3>
              <p className={styles.groupHint}>{t('settings.updateChannelHint')}</p>
            </header>
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segment} ${draft.preferences.updateChannel === 'stable' ? styles.segmentActive : ''}`}
                onClick={() => updatePreferencesDraft('updateChannel', 'stable')}
                aria-pressed={draft.preferences.updateChannel === 'stable'}
              >
                {t('updater.channelStable')}
              </button>
              <button
                type="button"
                className={`${styles.segment} ${draft.preferences.updateChannel === 'beta' ? styles.segmentActive : ''}`}
                onClick={() => updatePreferencesDraft('updateChannel', 'beta')}
                aria-pressed={draft.preferences.updateChannel === 'beta'}
              >
                {t('updater.channelBeta')}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function CurrentDesignSection() {
  const draft = settingsDraft.value
  if (!draft) return null

  if (!draft.currentDesign.enabled) {
    return (
      <div className={styles.emptyState}>
        <h3 className={styles.sectionTitle}>{t('settings.currentDesign')}</h3>
        <p className={styles.groupHint}>{t('settings.currentDesignDisabled')}</p>
      </div>
    )
  }

  const nameBlank = draft.currentDesign.name.trim().length === 0

  return (
    <div className={styles.sectionBody}>
      <header className={styles.sectionIntro}>
        <h3 className={styles.sectionTitle}>{t('settings.currentDesign')}</h3>
      </header>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.designName')}</span>
        <input
          className={`${styles.input} ${nameBlank ? styles.inputInvalid : ''}`}
          type="text"
          value={draft.currentDesign.name}
          onInput={(e) => {
            updateCurrentDesignDraft('name', (e.target as HTMLInputElement).value)
          }}
        />
        <span className={styles.fieldHint}>
          {nameBlank ? t('settings.designNameRequired') : t('settings.designNameHint')}
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings.description')}</span>
        <textarea
          className={styles.textarea}
          value={draft.currentDesign.description}
          onInput={(e) => {
            updateCurrentDesignDraft('description', (e.target as HTMLTextAreaElement).value)
          }}
          rows={6}
        />
        <span className={styles.fieldHint}>{t('settings.descriptionHint')}</span>
      </label>
    </div>
  )
}

export function SettingsModal() {
  const containerRef = useRef<HTMLDivElement>(null)

  useSignalEffect(() => {
    if (!settingsModalOpen.value) return
    requestAnimationFrame(() => {
      const target = containerRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      target?.focus()
    })
  })

  useEffect(() => {
    if (!settingsModalOpen.value) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return

      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
        return
      }

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault()
        last?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsModalOpen.value])

  if (!settingsModalOpen.value || !settingsDraft.value) return null

  const section = settingsModalSection.value
  const draftStale = isSettingsDraftStale()
  const saveDisabled = settingsSavePending.value || !canSaveSettingsDraft()

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className={styles.modal} ref={containerRef} tabIndex={-1}>
        <header className={styles.header}>
          <div>
            <h2 id="settings-modal-title" className={styles.title}>{t('settings.title')}</h2>
          </div>
        </header>

        <div className={styles.body}>
          <nav className={styles.sectionNav} aria-label={t('settings.title')}>
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`${styles.sectionButton} ${section === entry.id ? styles.sectionButtonActive : ''}`}
                onClick={() => setSettingsModalSection(entry.id)}
                aria-current={section === entry.id ? 'page' : undefined}
              >
                <span className={styles.sectionButtonTitle}>{t(entry.titleKey)}</span>
                <span className={styles.sectionButtonSummary}>{t(entry.summaryKey)}</span>
              </button>
            ))}
          </nav>

          <section className={styles.content}>
            {section === 'preferences' ? <PreferencesSection /> : <CurrentDesignSection />}
          </section>
        </div>

        <footer className={styles.footer}>
          {draftStale && <p className={styles.footerNotice}>{t('settings.designChangedWhileOpen')}</p>}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => cancelSettingsSession()}
            disabled={settingsSavePending.value}
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => { void saveSettingsSession() }}
            disabled={saveDisabled}
          >
            {t('settings.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
