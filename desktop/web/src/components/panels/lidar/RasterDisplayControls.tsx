import { useState } from 'preact/hooks'
import { setLidarEntryDisplay } from '../../../app/lidar/actions'
import { formatLocaleNumber, parseLocaleNumber } from '../../../app/analyses/model'
import { lidarDisplayStyle } from '../../../app/lidar/display'
import { formatLegendValue, legendGradient } from '../../../app/lidar/display-legend'
import { kindDisplayDefaults, kindRamps, unitSuffix } from '../../../app/lidar/item-types'
import type { LidarPresentationItem } from '../../../app/lidar/library-store'
import { locale } from '../../../app/settings/state'
import type { LidarColourRange, LidarRamp } from '../../../generated/contracts'
import { t } from '../../../i18n'
import { SegmentedControl } from '../../shared/SegmentedControl'
import { Slider } from '../../shared/Slider'
import styles from './raster-display-controls.module.css'

type RangeMode = LidarColourRange['mode']

/**
 * An open Site data item's display settings (canopi-f47t.42, spec §1.10
 * "Open item"; U49 Q32–Q38): Colors (the kind's ramps as swatches, Reverse,
 * the legend with ≤/≥ where the range cuts the data), Range (Data range, Cut
 * outliers, Custom, with Minimum and Maximum always showing the values in
 * use, and Reset while the display differs from the kind's), then the live
 * opacity. Colors and range commit on a click, Enter or leaving a field, never
 * while dragging, since each restyle re-tiles; only opacity is live. Every
 * write goes through `setLidarEntryDisplay`, which stores a kind's default as
 * null, so "differs from the default" is a null check.
 */
export function RasterDisplayControls({ item }: { readonly item: LidarPresentationItem }) {
  const style = lidarDisplayStyle(item)
  const percent = new Intl.NumberFormat(locale.value, { style: 'percent' })
  return (
    <div className={styles.controls}>
      {style && item.itemType && (
        <>
          <Colors item={item} ramps={kindRamps(item.itemType)} chosen={style.ramp} />
          <Legend ramp={style.ramp} reversed={style.reversed} range={style.rescale} data={item.displayRange} units={style.units} />
          <Range item={item} mode={(item.range ?? kindDisplayDefaults(item.itemType, item.units).range).mode} values={style.rescale} />
        </>
      )}
      <Slider
        label={t('canvas.lidar.layers.opacity')}
        ariaLabel={`${t('canvas.lidar.layers.opacity')}: ${item.name}`}
        min={0}
        max={100}
        value={Math.round(item.opacity * 100)}
        format={(value) => percent.format(value / 100)}
        onInput={(value) => setLidarEntryDisplay(item.id, { opacity: value / 100 })}
      />
    </div>
  )
}

function Colors({ item, ramps, chosen }: {
  readonly item: LidarPresentationItem
  readonly ramps: readonly LidarRamp[]
  readonly chosen: LidarRamp
}) {
  const label = t('siteData.display.colors')
  return (
    <div className={styles.section}>
      <span className={styles.heading} aria-hidden="true">{label}</span>
      <div className={styles.colors}>
        <div className={styles.swatches} role="radiogroup" aria-label={label}>
          {ramps.map((ramp) => {
            const name = t(`siteData.display.ramp.${ramp}`)
            return (
              <button
                key={ramp}
                type="button"
                role="radio"
                className={styles.swatchButton}
                aria-checked={ramp === chosen}
                aria-label={name}
                title={name}
                onClick={() => { if (ramp !== chosen) setLidarEntryDisplay(item.id, { ramp }) }}
              >
                <span className={styles.swatch} data-swatch style={{ backgroundImage: legendGradient(ramp, item.reversed) }} />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={item.reversed}
          onClick={() => setLidarEntryDisplay(item.id, { reversed: !item.reversed })}
        >
          {t('siteData.display.reverse')}
        </button>
      </div>
    </div>
  )
}

/** The ramp over the range in use; an end that cuts the data reads "≤" or "≥", since its colour holds every value beyond. */
function Legend({ ramp, reversed, range, data, units }: {
  readonly ramp: LidarRamp
  readonly reversed: boolean
  readonly range: readonly [number, number]
  readonly data: readonly [number, number] | null
  readonly units: string
}) {
  const [low, high] = range
  const lowText = formatLegendValue(low, units, locale.value)
  const highText = formatLegendValue(high, units, locale.value)
  return (
    <div className={styles.legend} aria-label={t('canvas.lidar.layers.legend')} role="group">
      <div className={styles.ramp} style={{ backgroundImage: legendGradient(ramp, reversed) }} />
      <div className={styles.legendLabels}>
        <span data-legend-end>{data && low > data[0] ? `≤ ${lowText}` : lowText}</span>
        <span data-legend-end>{data && high < data[1] ? `≥ ${highText}` : highText}</span>
      </div>
    </div>
  )
}

function Range({ item, mode, values }: {
  readonly item: LidarPresentationItem
  readonly mode: RangeMode
  readonly values: readonly [number, number]
}) {
  const label = t('siteData.display.range')
  const differs = item.ramp !== null || item.reversed || item.range !== null
  const choose = (next: RangeMode) => {
    setLidarEntryDisplay(item.id, {
      range: next === 'Custom' ? { mode: 'Custom', min: values[0], max: values[1] } : { mode: next },
    })
  }
  const commit = (min: number, max: number): boolean => {
    if (!(min < max)) return false
    if (min !== values[0] || max !== values[1] || mode !== 'Custom') {
      setLidarEntryDisplay(item.id, { range: { mode: 'Custom', min, max } })
    }
    return true
  }
  return (
    <div className={styles.section}>
      <span className={styles.heading} aria-hidden="true">{label}</span>
      <SegmentedControl<RangeMode>
        label={label}
        className={styles.modes}
        value={mode}
        onChange={choose}
        options={[
          { value: 'Data', label: t('siteData.display.dataRange') },
          { value: 'CutOutliers', label: <span title={t('siteData.display.cutOutliersHint')}>{t('siteData.display.cutOutliers')}</span> },
          { value: 'Custom', label: t('siteData.display.custom') },
        ]}
      />
      <div className={styles.fields}>
        {/* Keyed by the values in use, so a field that did not commit shows them again. */}
        <RangeField key={`min:${values[0]}`} label={t('siteData.display.minimum')} value={values[0]}
          onCommit={(min) => commit(min, values[1])} />
        <span className={styles.dash} aria-hidden="true">–</span>
        <RangeField key={`max:${values[1]}`} label={t('siteData.display.maximum')} value={values[1]}
          onCommit={(max) => commit(values[0], max)} />
        <span className={styles.units}>{unitSuffix(item.units).trim()}</span>
        {differs && (
          <button type="button" className={styles.reset}
            onClick={() => setLidarEntryDisplay(item.id, { ramp: null, reversed: false, range: null })}>
            {t('siteData.display.reset')}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One end of the range: it always shows the value in use, accepts the
 * locale's decimal mark, and commits on Enter or leaving the field; a value
 * that does not parse or would not keep minimum below maximum is reverted.
 */
function RangeField({ label, value, onCommit }: {
  readonly label: string
  readonly value: number
  onCommit(value: number): boolean
}) {
  const shown = formatLocaleNumber(value, locale.value)
  const [draft, setDraft] = useState(shown)
  const finish = () => {
    if (draft === shown) return
    const parsed = parseLocaleNumber(draft, locale.value)
    if (parsed === null || !onCommit(parsed)) setDraft(shown)
  }
  return (
    <input
      className={styles.field}
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish()
        } else if (event.key === 'Escape' && draft !== shown) {
          event.preventDefault()
          event.stopPropagation()
          setDraft(shown)
        }
      }}
    />
  )
}
