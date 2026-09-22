import { useState } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { t } from '../../i18n'
import {
  GOOGLE_KEY_PROMPT,
  resolveBasemapAvailability,
  type BasemapProviderConfig,
} from '../../maplibre/basemap-provider'
import { basemapStyle, googleMapsApiKey } from '../../app/settings/state'
import { mutateSettingsProjection } from '../../app/settings/projection'
import styles from './basemap-settings.module.css'

/** Build-time facts this surface cannot change. */
function buildConfig(): BasemapProviderConfig {
  return { mapTilerKey: import.meta.env.VITE_MAPTILER_KEY }
}

/** The three selectable provider identities, in the order the contract lists them. */
const PROVIDER_OPTIONS = [
  { style: 'street', labelKey: 'canvas.basemap.street' },
  { style: 'satellite', labelKey: 'canvas.basemap.satellite' },
  { style: 'google_satellite', labelKey: 'canvas.basemap.googleSatellite' },
] as const

/**
 * Basemap provider settings, shared by both editions.
 *
 * The provider choice, its availability, the required attribution and the exact
 * keyless prompt all come from `resolveBasemapAvailability`, so this surface
 * cannot disagree with what the map actually renders. Nothing here reads a
 * device key into a Design: the key round-trips through device settings only.
 */
export function BasemapSettings() {
  const [draftKey, setDraftKey] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const selected = basemapStyle.value
  const storedKey = googleMapsApiKey.value
  const resolved = useComputed(() =>
    resolveBasemapAvailability(selected, {
      ...buildConfig(),
      googleMapsApiKey: storedKey,
    }),
  )

  const keyEditing = draftKey !== null
  // The field shows the in-progress draft while editing and the stored value
  // otherwise, so a half-typed key is never rewritten underneath the user.
  const keyValue = keyEditing ? draftKey : (storedKey ?? '')

  return (
    <section className={styles.section} aria-label={t('canvas.basemap.title')}>
      <h3 className={styles.heading}>{t('canvas.basemap.title')}</h3>

      <fieldset className={styles.fieldset}>
        <legend>{t('canvas.basemap.provider')}</legend>
        {PROVIDER_OPTIONS.map((option) => {
          const availability = resolveBasemapAvailability(option.style, {
            ...buildConfig(),
            googleMapsApiKey: storedKey,
          })
          return (
            <label key={option.style} className={styles.choice}>
              <input
                type="radio"
                name="basemap-provider"
                checked={selected === option.style}
                onChange={() => {
                  setSaved(false)
                  mutateSettingsProjection((draft) => {
                    draft.basemapStyle = option.style
                  })
                }}
              />
              <span className={styles.choiceLabel}>{t(option.labelKey)}</span>
              {availability.state === 'unavailable' ? (
                <span className={styles.unavailable}>{t('canvas.basemap.unavailable')}</span>
              ) : null}
            </label>
          )
        })}
      </fieldset>

      {selected === 'google_satellite' ? (
        <form
          className={styles.keyForm}
          onSubmit={(event) => {
            event.preventDefault()
            const next = draftKey ?? storedKey ?? ''
            mutateSettingsProjection((draft) => {
              draft.googleMapsApiKey = next
            })
            setDraftKey(null)
            setSaved(true)
          }}
        >
          <label className={styles.field}>
            <span>{t('canvas.basemap.googleKey')}</span>
            <input
              type="password"
              autoComplete="off"
              spellcheck={false}
              value={keyValue}
              onInput={(event) => {
                setSaved(false)
                setDraftKey(event.currentTarget.value)
              }}
            />
          </label>
          <div className={styles.keyActions}>
            <button type="submit" className={styles.primary}>
              {t('canvas.basemap.saveKey')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setDraftKey(null)
                setSaved(false)
                mutateSettingsProjection((draft) => {
                  draft.googleMapsApiKey = null
                })
              }}
            >
              {t('canvas.basemap.clearKey')}
            </button>
          </div>
          {saved ? (
            <p className={styles.saved} role="status">
              {t('canvas.basemap.keySaved')}
            </p>
          ) : null}
          <p className={styles.note}>{t('canvas.basemap.keyLocalOnly')}</p>
        </form>
      ) : null}

      {resolved.value.state === 'unavailable' ? (
        <p className={styles.unavailableReason} role="status">
          {resolved.value.reason}
        </p>
      ) : (
        <>
          {/* A keyless Google selection keeps its exact non-blocking prompt. */}
          {resolved.value.descriptor.notice === GOOGLE_KEY_PROMPT ? (
            <p className={styles.notice} role="status">
              {t('canvas.basemap.googleKeyPrompt')}
            </p>
          ) : null}
          <p className={styles.attribution}>{resolved.value.descriptor.attribution}</p>
        </>
      )}
    </section>
  )
}
