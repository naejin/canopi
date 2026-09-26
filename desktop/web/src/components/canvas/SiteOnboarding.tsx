import { useEffect, useId, useRef } from 'preact/hooks'
import { placeSearch } from '../../app/geocoding/place-search-session'
import { PLACE_SEARCH_ZOOM } from '../../app/geocoding/place-search-ui'
import { selectPanel } from '../../app/shell/state'
import {
  closeStartDesignCard,
  finishSiteLocate,
  foundSiteLabel,
  searchSiteAgain,
  siteLocateOpen,
  startDesignCardOpen,
} from '../../app/site-onboarding/state'
import { selectCanvasTool } from '../../app/workspace-commands/canvas-actions'
import { currentCanvasViewportCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import { PlaceCombobox } from './PlaceSearch'
import styles from './SiteOnboarding.module.css'

/** New-Design guidance over the map: where the site is, then how to start. */
export function SiteOnboarding() {
  if (siteLocateOpen.value) return <SiteLocateDialog />
  if (!startDesignCardOpen.value) return null
  return (
    <>
      <StartDesignCard />
      <FoundSiteChip />
    </>
  )
}

function SiteLocateDialog() {
  const titleId = useId()
  const attribution = placeSearch.attribution.value

  return (
    <section
      className={styles.locate}
      role="dialog"
      aria-labelledby={titleId}
      data-site-locate
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        finishSiteLocate(null)
      }}
    >
      <h2 className={styles.locateTitle} id={titleId}>{t('siteOnboarding.locateTitle')}</h2>
      <p className={styles.locateIntro}>{t('siteOnboarding.locateIntro')}</p>
      <PlaceCombobox
        variant="dialog"
        autoFocus
        label={t('canvas.placeSearch.placeholder')}
        onPick={(result, label) => {
          currentCanvasViewportCommandSurface.peek()?.showPlace(result, PLACE_SEARCH_ZOOM)
          finishSiteLocate(label)
        }}
      />
      <div className={styles.locateFooter}>
        <span className={styles.attribution}>{attribution ?? t('siteOnboarding.placeNamesCredit')}</span>
        <button type="button" className={styles.link} onClick={() => finishSiteLocate(null)}>
          {t('siteOnboarding.skip')}
        </button>
      </div>
    </section>
  )
}

function StartDesignCard() {
  const titleId = useId()
  const card = useRef<HTMLElement>(null)

  useEffect(() => {
    card.current?.querySelector<HTMLButtonElement>('[data-start-primary]')?.focus()
  }, [])

  return (
    <section ref={card} className={styles.startCard} role="region" aria-labelledby={titleId} data-start-design>
      <div className={styles.startHeader}>
        <h2 className={styles.startTitle} id={titleId}>{t('siteOnboarding.startTitle')}</h2>
        <button type="button" className={styles.close} aria-label={t('siteOnboarding.closeStart')} onClick={closeStartDesignCard}>
          <ControlIcon name="close" size={18} />
        </button>
      </div>
      <ol className={styles.steps}>
        <li>{t('siteOnboarding.stepZone')}</li>
        <li>{t('siteOnboarding.stepCatalog')}</li>
        <li>{t('siteOnboarding.stepSave')}</li>
      </ol>
      <div className={styles.startActions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            closeStartDesignCard()
            selectPanel('plant-db')
          }}
        >
          {t('siteOnboarding.openCatalog')}
        </button>
        <button
          type="button"
          className={styles.primary}
          data-start-primary
          onClick={() => {
            closeStartDesignCard()
            selectCanvasTool('polygon')
          }}
        >
          {t('siteOnboarding.drawZone')}
        </button>
      </div>
    </section>
  )
}

function FoundSiteChip() {
  const label = foundSiteLabel.value
  return (
    <div className={styles.foundChip} role="status" data-found-site>
      <ControlIcon name="pin" />
      <span className={styles.foundLabel}>{label ?? t('siteOnboarding.noPlace')}</span>
      <button type="button" className={styles.link} onClick={searchSiteAgain}>
        {t('siteOnboarding.searchAgain')}
      </button>
    </div>
  )
}
