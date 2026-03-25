import { useSignal, useSignalEffect } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision } from '../../state/document'
import { designLocation } from '../../state/canvas'
import styles from './LocationInput.module.css'

export function LocationInput() {
  void locale.value

  const design = currentDesign.value
  const location = design?.location ?? null

  const latInput = useSignal(location?.lat?.toString() ?? '')
  const lonInput = useSignal(location?.lon?.toString() ?? '')
  const altInput = useSignal(location?.altitude_m?.toString() ?? '')

  // Resync input values when the design changes (e.g., open different file)
  useSignalEffect(() => {
    const loc = currentDesign.value?.location ?? null
    latInput.value = loc?.lat?.toString() ?? ''
    lonInput.value = loc?.lon?.toString() ?? ''
    altInput.value = loc?.altitude_m?.toString() ?? ''
    designLocation.value = loc ? { lat: loc.lat, lon: loc.lon } : null
  })

  function save() {
    if (!design) return
    const lat = parseFloat(latInput.value)
    const lon = parseFloat(lonInput.value)
    if (isNaN(lat) || isNaN(lon)) return
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return

    const alt = parseFloat(altInput.value)

    const newLoc = { lat, lon, altitude_m: isNaN(alt) ? null : alt }
    currentDesign.value = { ...design, location: newLoc }
    designLocation.value = { lat, lon }
    nonCanvasRevision.value++
  }

  function clear() {
    if (!design) return
    currentDesign.value = { ...design, location: null }
    designLocation.value = null
    latInput.value = ''
    lonInput.value = ''
    altInput.value = ''
    nonCanvasRevision.value++
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>{t('canvas.location.title')}</h3>

      <div className={styles.fields}>
        <label className={styles.label}>
          {t('canvas.location.latitude')}
          <input
            type="number"
            className={styles.input}
            value={latInput.value}
            onInput={(e) => { latInput.value = e.currentTarget.value }}
            placeholder="-90 to 90"
            step="0.0001"
            min="-90"
            max="90"
          />
        </label>

        <label className={styles.label}>
          {t('canvas.location.longitude')}
          <input
            type="number"
            className={styles.input}
            value={lonInput.value}
            onInput={(e) => { lonInput.value = e.currentTarget.value }}
            placeholder="-180 to 180"
            step="0.0001"
            min="-180"
            max="180"
          />
        </label>

        <label className={styles.label}>
          {t('canvas.location.altitude')}
          <input
            type="number"
            className={styles.input}
            value={altInput.value}
            onInput={(e) => { altInput.value = e.currentTarget.value }}
            placeholder={t('canvas.location.optional')}
            step="1"
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} onClick={save}>
          {t('canvas.location.save')}
        </button>
        {location && (
          <button type="button" className={styles.clearBtn} onClick={clear}>
            {t('canvas.location.clear')}
          </button>
        )}
      </div>

      {location && (
        <p className={styles.current}>
          {t('canvas.location.current')}: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          {location.altitude_m != null && ` (${location.altitude_m}m)`}
        </p>
      )}
    </div>
  )
}
