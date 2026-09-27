import type { RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import {
  registerMapArea,
  registerMapOccluder,
  type MapOccluderSide,
} from '../../app/shell/visible-map-area'

/** Registers the element the map fills, so chrome can frame and centre into what stays visible. */
export function useMapArea(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerMapArea(element) : undefined
  }, [ref])
}

/** Registers floating chrome that covers an edge of the map (inferred from its box when `side` is absent). */
export function useMapOccluder(ref: RefObject<HTMLElement>, side?: MapOccluderSide): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerMapOccluder(element, side) : undefined
  }, [ref, side])
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
    }
    reserve()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve)
    observer?.observe(row)
    return () => {
      observer?.disconnect()
      host.style.removeProperty('--chrome-rail-top')
    }
  }, [ref])
}
