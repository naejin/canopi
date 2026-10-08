import { setLidarEntryDisplay } from '../../../app/lidar/actions'
import type { LidarPresentationItem } from '../../../app/lidar/library-store'
import { locale } from '../../../app/settings/state'
import { t } from '../../../i18n'
import { Slider } from '../../shared/Slider'

/**
 * An open Site data item's display settings (canopi-f47t.42, spec §1.10
 * "Open item"; stream B builds them): Colors with Reverse and the legend,
 * Range with Reset, and the live opacity Slider. Commit 0's stub with the
 * final signature holds the opacity only.
 */
export function RasterDisplayControls({ item }: { readonly item: LidarPresentationItem }) {
  return (
    <Slider
      label={t('canvas.lidar.layers.opacity')}
      ariaLabel={`${t('canvas.lidar.layers.opacity')}: ${item.name}`}
      min={0}
      max={100}
      value={Math.round(item.opacity * 100)}
      format={(value) => new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)}
      onInput={(value) => setLidarEntryDisplay(item.id, { opacity: value / 100 })}
    />
  )
}
