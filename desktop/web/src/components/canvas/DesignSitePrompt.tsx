import { useId } from 'preact/hooks'
import { answerDesignSite, pendingDesignSitePrompt } from '../../app/document-session/design-site-prompt'
import { placeSearch } from '../../app/geocoding/place-search-session'
import { locale } from '../../app/settings/state'
import { currentDesign } from '../../app/document-session/store'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { geographicViewOf } from '../../canvas/session-plane'
import { t } from '../../i18n'
import type { GeoPoint, PendingDesignSite } from '../../types/design'
import { PlaceCombobox } from './PlaceSearch'
import styles from './SiteOnboarding.module.css'

/**
 * "Where is your site?" for a Design made before Canopi placed Designs on the
 * map: the site-locate card as a variant that names the Design, its counts and
 * its extent. A picked place is the site; while a map is on screen its centre
 * is offered too, so the map stays usable under the card. Cancel leaves the
 * Design unopened and nothing is written.
 */
export function DesignSitePrompt() {
  const pending = pendingDesignSitePrompt.value
  if (!pending) return null
  return <DesignSitePromptCard pending={pending} />
}

function DesignSitePromptCard({ pending }: { readonly pending: PendingDesignSite }) {
  const titleId = useId()
  const attribution = placeSearch.attribution.value
  const mapCentre = readMapCentre()
  const format = new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 })
  const others = Math.max(0, pending.object_count - pending.plant_count - pending.zone_count)

  return (
    <section
      className={`${styles.locate} ${styles.pendingSite}`}
      role="dialog"
      aria-labelledby={titleId}
      data-design-site-prompt
      data-preserve-overlays="true"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        answerDesignSite(null)
      }}
    >
      <h2 className={styles.locateTitle} id={titleId}>{t('siteOnboarding.locateTitle')}</h2>
      <p className={styles.locateIntro}>{t('siteOnboarding.pendingIntro', { name: pending.name })}</p>
      <dl className={styles.facts}>
        <div><dt>{t('siteOnboarding.pendingPlants')}</dt><dd>{format.format(pending.plant_count)}</dd></div>
        <div><dt>{t('siteOnboarding.pendingZones')}</dt><dd>{format.format(pending.zone_count)}</dd></div>
        <div><dt>{t('siteOnboarding.pendingOthers')}</dt><dd>{format.format(others)}</dd></div>
        <div>
          <dt>{t('siteOnboarding.pendingExtent')}</dt>
          <dd>{t('siteOnboarding.pendingExtentValue', { width: format.format(pending.width_m), height: format.format(pending.height_m) })}</dd>
        </div>
      </dl>
      <PlaceCombobox
        variant="dialog"
        autoFocus
        label={t('canvas.placeSearch.placeholder')}
        onPick={(result) => answerDesignSite({ lon: result.lon, lat: result.lat })}
      />
      <p className={styles.locateIntro}>
        {mapCentre ? t('siteOnboarding.pendingMapHint') : t('siteOnboarding.pendingSearchHint')}
      </p>
      <div className={styles.locateFooter}>
        <span className={styles.attribution}>{attribution ?? t('siteOnboarding.placeNamesCredit')}</span>
        <span className={styles.footerActions}>
          <button type="button" className={styles.link} onClick={() => answerDesignSite(null)}>
            {t('canvas.file.cancel')}
          </button>
          {mapCentre && (
            <button type="button" className={styles.primary} onClick={() => answerDesignSite(mapCentre)}>
              {t('siteOnboarding.pendingPlaceHere')}
            </button>
          )}
        </span>
      </div>
    </section>
  )
}

/**
 * The map's centre as a site, while a map with a settled frame is on screen.
 * The canvas session outlives a closed Design (the Start screen keeps the
 * runtime warm), so an open Design is required too, or the offer would place
 * the objects at a view nobody is looking at.
 */
function readMapCentre(): GeoPoint | null {
  if (currentDesign.value === null) return null
  const queries = currentCanvasQuerySurface.value
  const plane = queries?.sessionPlane.value
  if (!queries || !plane) return null
  const view = geographicViewOf(queries.viewport.value, plane)
  return view ? { lon: view.lon, lat: view.lat } : null
}
