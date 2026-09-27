import { useId, useRef, useState } from 'preact/hooks'
import { saveGoogleMapsApiKey } from '../../app/map-layers/actions'
import { googleMapsApiKey } from '../../app/settings/state'
import { t } from '../../i18n'
import { SegmentedControl } from './SegmentedControl'
import styles from './SettingsDialog.module.css'

type SatelliteSource = 'free' | 'google'

/** Stands in for a saved key while it is masked; never derived from the key. */
const SAVED_KEY_MASK = '••••••••••••••••'

/**
 * Settings › Map and imagery › Satellite imagery: the free imagery, or the
 * user's own Google Maps Platform key.
 *
 * The key is a device-local credential. It is never rendered anywhere but
 * inside this input, and there only while Show is pressed: masked, the input
 * stays empty and a stored key is only hinted by the placeholder. Choosing
 * Free imagery forgets the key, like Remove key.
 */
export function SettingsGoogleKeyField() {
  const stored = googleMapsApiKey.value?.trim() ? googleMapsApiKey.value : null
  const [chosen, setChosen] = useState<SatelliteSource>(stored ? 'google' : 'free')
  const [shown, setShown] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'saved' | 'removed' | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  // A key saved elsewhere (the Layers panel) means the Google source.
  const source: SatelliteSource = stored ? 'google' : chosen
  const pending = draft?.trim() ?? ''
  const canSave = pending !== '' && pending !== stored

  function removeKey(): void {
    saveGoogleMapsApiKey(null)
    setDraft(null)
    setShown(false)
    setStatus('removed')
  }

  function saveKey(): void {
    if (!canSave) return
    saveGoogleMapsApiKey(pending)
    setDraft(null)
    setStatus('saved')
  }

  return (
    <>
      <div className={styles.field}>
        <span className={styles.label}>{t('settings.satelliteSource')}</span>
        <SegmentedControl<SatelliteSource>
          label={t('settings.satelliteSource')}
          value={source}
          options={[
            { value: 'free', label: t('settings.satelliteFree') },
            { value: 'google', label: t('settings.satelliteGoogle') },
          ]}
          onChange={(next) => {
            setChosen(next)
            if (next === 'free' && stored) removeKey()
            if (next === 'google') queueMicrotask(() => input.current?.focus())
          }}
        />
        <span className={styles.hint}>{t('settings.satelliteHint')}</span>
      </div>
      {source === 'google' && (
        <form
          className={styles.field}
          onSubmit={(event) => {
            event.preventDefault()
            saveKey()
          }}
        >
          <label className={styles.label} htmlFor={`${id}-key`}>{t('settings.googleKey')}</label>
          <div className={styles.keyRow}>
            <input
              ref={input}
              id={`${id}-key`}
              className={styles.input}
              type={shown ? 'text' : 'password'}
              autoComplete="off"
              spellcheck={false}
              aria-describedby={`${id}-note`}
              data-google-key-input
              // Masked, a stored key never enters the page; Show puts it in this input only.
              value={draft ?? (shown && stored ? stored : '')}
              placeholder={stored ? SAVED_KEY_MASK : ''}
              onInput={(event) => {
                setStatus(null)
                setDraft(event.currentTarget.value)
              }}
            />
            <button
              type="button"
              className={styles.button}
              aria-pressed={shown}
              disabled={!stored && !draft}
              onClick={() => setShown(!shown)}
            >
              {t('settings.showKey')}
            </button>
            {canSave && <button type="submit" className={styles.primaryButton}>{t('settings.saveKey')}</button>}
            {stored && (
              <button type="button" className={styles.ghostButton} onClick={removeKey}>
                {t('settings.removeKey')}
              </button>
            )}
          </div>
          <span className={styles.hint} id={`${id}-note`}>
            {stored ? `${t('settings.googleKeyStoredNote')} ${t('settings.googleKeyLocal')}` : t('settings.googleKeyLocal')}
          </span>
        </form>
      )}
      {status && (
        <p className={styles.status} role="status">
          {t(status === 'saved' ? 'settings.googleKeySaved' : 'settings.googleKeyRemoved')}
        </p>
      )}
    </>
  )
}
