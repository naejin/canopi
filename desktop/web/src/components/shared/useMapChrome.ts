import type { RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import {
  refreshVisibleMapArea,
  registerMapArea,
  registerMapOccluder,
  registerRail,
  registerUnderRail,
  type ChromeRail,
  type MapOccluderSide,
} from '../../app/shell/visible-map-area'

/** Registers the element the map fills, so chrome can frame and centre into what stays visible. */
export function useMapArea(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerMapArea(element) : undefined
  }, [ref])
}

/**
 * Registers floating chrome that covers an edge of the map (inferred from its
 * box when `side` is absent); `covers` false leaves it out, for chrome placed
 * from the visible map frame itself (the phone zoom group).
 */
export function useMapOccluder(ref: RefObject<HTMLElement>, side?: MapOccluderSide, covers = true): void {
  useLayoutEffect(() => {
    const element = covers ? ref.current : null
    return element ? registerMapOccluder(element, side) : undefined
  }, [ref, side, covers])
}

/** Registers a rail, which covers its edge and folds its last entries into More when short. */
export function useRail(ref: RefObject<HTMLElement>, kind: ChromeRail): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerRail(kind, element) : undefined
  }, [ref, kind])
}

/**
 * Registers chrome under a rail's column that the rail ends above
 * (`mounted` follows an element rendered only some of the time).
 */
export function useUnderRail(ref: RefObject<HTMLElement>, kind: ChromeRail, mounted = true): void {
  useLayoutEffect(() => {
    const element = mounted ? ref.current : null
    return element ? registerUnderRail(kind, element) : undefined
  }, [ref, kind, mounted])
}

/**
 * Publishes the element's width as a custom property on its parent (the map
 * area), so map-owned DOM such as the MapLibre attribution can be placed
 * beside the chrome.
 */
export function usePublishedWidth(ref: RefObject<HTMLElement>, property: `--${string}`): void {
  useLayoutEffect(() => {
    const element = ref.current
    const host = element?.parentElement
    if (!element || !host || typeof ResizeObserver === 'undefined') return
    const publish = () => host.style.setProperty(property, `${element.offsetWidth}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      host.style.removeProperty(property)
    }
  }, [ref, property])
}

/**
 * An app-wide notice's own row below the title bar. Everything that starts
 * under the title bar (rails, dock, tool cards, chips, the start screen) is
 * placed from `--chrome-rail-top`, so the row lowers that line on its
 * container while it shows instead of covering controls; fitting and chips
 * keep below it too.
 */
export function useChromeRow(ref: RefObject<HTMLElement>): void {
  useMapOccluder(ref, 'top')
  useLayoutEffect(() => {
    const row = ref.current
    const host = row?.parentElement
    if (!row || !host) return
    const reserve = () => {
      host.style.setProperty('--chrome-rail-top', `calc(${row.offsetTop + row.offsetHeight}px + var(--space-2))`)
      // The rails moved without resizing; measure the room they have again.
      refreshVisibleMapArea()
    }
    reserve()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve)
    observer?.observe(row)
    return () => {
      observer?.disconnect()
      host.style.removeProperty('--chrome-rail-top')
      refreshVisibleMapArea()
    }
  }, [ref])
}
