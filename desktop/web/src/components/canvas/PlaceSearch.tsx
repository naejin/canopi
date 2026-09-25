import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { geocodingTransport } from '#geocoding-transport'
import { createPlaceSearchController, type PlaceSearchResult } from '../../app/geocoding/place-search'
import { closePlaceSearch, openPlaceSearch, placeSearchOpen, PLACE_SEARCH_ZOOM } from '../../app/geocoding/place-search-ui'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../canvas/session-plane'
import { VIEW_SHORTCUTS } from '../../shortcuts/definitions'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { t } from '../../i18n'
import styles from './PlaceSearch.module.css'

/**
 * The pin control under the inspection lens: an icon button that opens an
 * inline search for a place name or coordinates. Enter searches (never while
 * typing); choosing a result moves the view only — design objects never move.
 */
export function PlaceSearch() {
  const open = placeSearchOpen.value
  const launcher = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)
  const [query, setQuery] = useState('')
  const search = useMemo(() => createPlaceSearchController({ transport: geocodingTransport }), [])
  useEffect(() => () => search.dispose(), [search])
  useLayoutEffect(() => {
    if (open) input.current?.focus()
    else if (wasOpen.current) launcher.current?.focus()
    wasOpen.current = open
  }, [open])

  const close = () => {
    search.clear()
    closePlaceSearch()
  }
  const choose = (result: PlaceSearchResult) => {
    currentCanvasViewportCommandSurface.value?.showPlace(result, PLACE_SEARCH_ZOOM)
    close()
  }
  const status = search.status.value
  const label = t('canvas.placeSearch.open')
  const prompt = !open && isEmptySite()

  return (
    <div className={styles.root} data-preserve-overlays="true">
      <button
        ref={launcher}
        type="button"
        className={styles.launcher}
        aria-label={label}
        aria-expanded={open}
        aria-keyshortcuts="Control+F"
        hidden={open}
        onClick={openPlaceSearch}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 15s5-4.6 5-8.5a5 5 0 1 0-10 0C3 10.4 8 15 8 15Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="8" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <ButtonTooltip label={label} shortcut={VIEW_SHORTCUTS.searchPlace} side="left" />
      </button>
      {prompt && (
        <button type="button" className={styles.prompt} onClick={openPlaceSearch}>
          {t('canvas.placeSearch.emptyPrompt')}
        </button>
      )}
      {open && (
        <form
          className={styles.panel}
          role="search"
          aria-label={label}
          onSubmit={(event) => {
            event.preventDefault()
            void search.search(query)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        >
          <input
            ref={input}
            type="search"
            className={styles.input}
            value={query}
            placeholder={t('canvas.placeSearch.placeholder')}
            aria-label={t('canvas.placeSearch.placeholder')}
            spellcheck={false}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          {status === 'searching' && <p className={styles.status} role="status">{t('canvas.placeSearch.searching')}</p>}
          {status === 'no-results' && <p className={styles.status} role="status">{t('canvas.placeSearch.noResults')}</p>}
          {status === 'error' && <p className={styles.status} role="status">{t('canvas.placeSearch.error')}</p>}
          {status === 'results' && (
            <ul className={styles.results} aria-label={t('canvas.placeSearch.results')}>
              {search.results.value.map((result) => (
                <li key={`${result.lat},${result.lon},${result.label}`}>
                  <button type="button" className={styles.result} onClick={() => choose(result)}>{result.label}</button>
                </li>
              ))}
            </ul>
          )}
          {search.attribution.value && <p className={styles.attribution}>{search.attribution.value}</p>}
        </form>
      )}
    </div>
  )
}

/**
 * An empty Design that opened without a remembered view has its session plane
 * at the default world view: invite a site search. This reads the plane, not
 * the live last view, which the camera rewrites as soon as it settles.
 */
function isEmptySite(): boolean {
  const queries = currentCanvasQuerySurface.value
  const origin = queries?.sessionPlane.value?.origin
  if (!queries || !origin) return false
  if (origin.lon !== DEFAULT_NEW_DESIGN_VIEW.lon || origin.lat !== DEFAULT_NEW_DESIGN_VIEW.lat) return false
  void queries.revision.scene.value
  return queries.getScenePhysicalExtentMeters() === null
}
