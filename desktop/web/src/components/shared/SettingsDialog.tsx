import { mutateSettingsProjection } from '../../app/settings/projection'
import { locale, theme } from '../../app/settings/state'
import { closeSettingsDialog, settingsDialogOpen } from '../../app/shell/dialogs'
import { toggleToolNames, toolRailShowsNames } from '../../app/tool-rail/learning'
import type { Locale, Theme } from '../../types/settings'
import { t } from '../../i18n'
import { Dropdown, type DropdownItem } from './Dropdown'
import { SegmentedControl } from './SegmentedControl'
import { Switch } from './Switch'
import { WorkspaceDialog } from './WorkspaceDialog'
import styles from './SettingsDialog.module.css'

/** Each language in its own name, so anyone can find theirs. */
const LANGUAGE_ITEMS: DropdownItem<Locale>[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Deutsch' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'ru', label: 'Русский' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
]

/** File › Settings… (Ctrl ,): device preferences, never stored in a Design. */
export function SettingsDialog() {
  if (!settingsDialogOpen.value) return null
  const currentLanguage = LANGUAGE_ITEMS.find((item) => item.value === locale.value)
  return (
    <WorkspaceDialog title={t('settings.title')} onClose={closeSettingsDialog}>
      <section className={styles.section} aria-labelledby="settings-appearance">
        <h3 className={styles.heading} id="settings-appearance">{t('settings.appearance')}</h3>
        <div className={styles.field}>
          <span className={styles.label}>{t('settings.theme')}</span>
          <SegmentedControl<Theme>
            label={t('settings.theme')}
            value={theme.value}
            options={[
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') },
            ]}
            onChange={(next) => mutateSettingsProjection((settings) => { settings.theme = next }, { persist: 'immediate' })}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>{t('settings.language')}</span>
          <Dropdown<Locale>
            trigger={currentLanguage?.label ?? locale.value}
            items={LANGUAGE_ITEMS}
            value={locale.value}
            ariaLabel={t('settings.language')}
            preserveOverlays
            floating
            onChange={(next) => mutateSettingsProjection((settings) => { settings.locale = next }, { persist: 'immediate' })}
          />
        </div>
        <Switch
          label={t('settings.toolNames')}
          hint={t('settings.toolNamesHint')}
          checked={toolRailShowsNames.value}
          onChange={(checked) => { if (checked !== toolRailShowsNames.peek()) toggleToolNames() }}
        />
      </section>
    </WorkspaceDialog>
  )
}
