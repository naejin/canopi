import { useSignalEffect } from '@preact/signals'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { parseCoordinates, placeSearch as search, type PlaceSearchResult } from '../../app/geocoding/place-search-session'
import { PLACE_SEARCH_ZOOM, placeSearchFocusRequest } from '../../app/geocoding/place-search-ui'
import { currentCanvasViewportCommandSurface } from '../../canvas/session'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { formatShortcut } from '../../app/shell-commands/shortcut-text'
import { t } from '../../i18n'
import { ControlIcon } from '../shared/ControlIcon'
import styles from './PlaceSearch.module.css'

interface PlaceOption {
  readonly id: string
  readonly result: PlaceSearchResult
  readonly label: string
  readonly detail: string
}

/** "48.2201° N, 0.0351° E": the coordinates a result or the field names. */
export function formatCoordinates(lat: number, lon: number): string {
  return t('canvas.placeSearch.coordinates', {
    lat: Math.abs(lat).toFixed(4),
    lon: Math.abs(lon).toFixed(4),
    northSouth: t(lat < 0 ? 'canvas.placeSearch.south' : 'canvas.placeSearch.north'),
    eastWest: t(lon < 0 ? 'canvas.placeSearch.west' : 'canvas.placeSearch.east'),
  })
}

interface PlaceComboboxProps {
  readonly variant: 'title-bar' | 'dialog'
  /** Called with the chosen place; the caller moves the camera (camera only). */
  onPick(result: PlaceSearchResult, label: string): void
  readonly disabled?: boolean
  readonly autoFocus?: boolean
  /** Placeholder and accessible name. */
  readonly label: string
}

/**
 * A place combobox over the app's one place search: Enter searches (never
 * while typing); coordinates go straight there; choosing a result closes the
 * list and clears the field; Escape clears it.
 */
export function PlaceCombobox({ variant, onPick, disabled = false, autoFocus = false, label }: PlaceComboboxProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const seenFocusRequest = useRef(placeSearchFocusRequest.peek())

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])
  const listId = useId()
  const optionPrefix = useId()

  useSignalEffect(() => {
    if (variant !== 'title-bar') return
    const request = placeSearchFocusRequest.value
    if (request === seenFocusRequest.current) return
    seenFocusRequest.current = request
    input.current?.focus()
    input.current?.select()
    setExpanded(true)
  })

  const status = search.status.value
  const coordinates = parseCoordinates(query)
  const options: PlaceOption[] = []
  if (coordinates) {
    options.push({
      id: `${optionPrefix}-coordinates`,
      result: { ...coordinates, label: query.trim(), detail: null, source: 'coordinates' },
      label: formatCoordinates(coordinates.lat, coordinates.lon),
      detail: t('canvas.placeSearch.goStraightThere'),
    })
  } else if (status === 'results') {
    search.results.value.forEach((result, index) => {
      options.push({
        id: `${optionPrefix}-${index}`,
        result,
        label: result.label,
        detail: result.detail ?? '',
      })
    })
  }
  const statusText = coordinates ? null
    : status === 'searching' ? t('canvas.placeSearch.searching')
      : status === 'no-results' ? t('canvas.placeSearch.noResults')
        : status === 'error' ? t('canvas.placeSearch.error')
          : null
  const listVisible = (variant === 'dialog' || expanded) && (options.length > 0 || statusText !== null)
  // A coordinate row is the answer to what was typed, so it starts active.
  const activeOption = activeIndex >= 0 ? activeIndex : coordinates ? 0 : -1
  const active = activeOption < options.length ? options[activeOption] ?? null : null

  function clear(): void {
    setQuery('')
    setActiveIndex(-1)
    search.clear()
  }

  function pick(option: PlaceOption): void {
    onPick(option.result, option.label)
    clear()
    setExpanded(false)
    if (variant === 'title-bar') input.current?.blur()
  }

  function submit(): void {
    if (active) {
      pick(active)
      return
    }
    const coordinateOption = options[0]
    if (coordinates && coordinateOption) {
      pick(coordinateOption)
      return
    }
    setExpanded(true)
    setActiveIndex(-1)
    void search.search(query)
  }

  return (
    <div
      ref={root}
      className={`${styles.root} ${variant === 'dialog' ? styles.dialogVariant : styles.titleBarVariant}`}
      data-preserve-overlays="true"
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null
        if (variant === 'title-bar' && (!next || !root.current?.contains(next))) setExpanded(false)
      }}
    >
      <label className={styles.field}>
        <ControlIcon name="search" />
        <input
          ref={input}
          type="text"
          role="combobox"
          className={styles.input}
          value={query}
          placeholder={label}
          aria-label={label}
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active?.id}
          aria-keyshortcuts={variant === 'title-bar' ? 'Control+K Meta+K' : undefined}
          disabled={disabled}
          spellcheck={false}
          autoComplete="off"
          onFocus={() => setExpanded(true)}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setActiveIndex(-1)
            setExpanded(true)
            // Results belong to the text that asked for them.
            if (search.status.peek() !== 'idle') search.clear()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'ArrowDown' && options.length > 0) {
              event.preventDefault()
              setExpanded(true)
              setActiveIndex((index) => (index + 1) % options.length)
            } else if (event.key === 'ArrowUp' && options.length > 0) {
              event.preventDefault()
              setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1))
            } else if (event.key === 'Escape') {
              if (variant === 'dialog' && query === '') return
              event.preventDefault()
              event.stopPropagation()
              if (query === '' && variant === 'title-bar') {
                setExpanded(false)
                input.current?.blur()
                return
              }
              clear()
            }
          }}
        />
        {variant === 'title-bar' && (query
          ? (
              <button type="button" className={styles.clear} aria-label={t('canvas.placeSearch.clear')} onClick={() => { clear(); input.current?.focus() }}>
                <ControlIcon name="close" />
              </button>
            )
          : <kbd className={styles.key} aria-hidden="true">{formatShortcut('Ctrl+K', t)}</kbd>)}
        {variant === 'dialog' && <kbd className={styles.key} aria-hidden="true">{t('shortcutKeys.enter')}</kbd>}
      </label>
      <div className={listVisible ? styles.popup : styles.popupHidden}>
        {statusText && <p className={styles.status} role="status">{statusText}</p>}
        <ul id={listId} role="listbox" aria-label={t('canvas.placeSearch.results')} className={styles.results}>
          {options.map((option, index) => (
            <li
              key={option.id}
              id={option.id}
              role="option"
              aria-selected={index === activeOption}
              className={styles.option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
            >
              <ControlIcon name="pin" size={18} />
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.detail && <span className={styles.optionDetail}>{option.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {!coordinates && search.attribution.value && options.length > 0 && variant === 'title-bar' && (
          <p className={styles.attribution}>{search.attribution.value}</p>
        )}
      </div>
    </div>
  )
}

/** The title-bar place field (View › Search a place…, Ctrl K). Choosing a place moves the camera only. */
export function PlaceSearchField({ compact = false }: { readonly compact?: boolean }) {
  const viewport = currentCanvasViewportCommandSurface.value
  // While "Where is your site?" asks, its field is the place search.
  if (siteLocateOpen.value) return null
  return (
    <PlaceCombobox
      variant="title-bar"
      label={t(compact ? 'canvas.placeSearch.placeholderShort' : 'canvas.placeSearch.placeholder')}
      disabled={!viewport}
      onPick={(result) => {
        currentCanvasViewportCommandSurface.peek()?.showPlace(result, PLACE_SEARCH_ZOOM)
      }}
    />
  )
}
