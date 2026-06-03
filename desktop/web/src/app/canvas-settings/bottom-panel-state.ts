import { signal } from '@preact/signals'

export type BottomPanelTab = 'timeline' | 'budget' | 'consortium'
export type BottomPanelHeightPreferences = Record<BottomPanelTab, number | null>

export const VISIBLE_BOTTOM_PANEL_TABS: BottomPanelTab[] = ['timeline', 'budget', 'consortium']
export const MIN_BOTTOM_PANEL_HEIGHT = 140
export const DEFAULT_BOTTOM_PANEL_HEIGHTS: Record<BottomPanelTab, number> = {
  timeline: 224,
  budget: 224,
  consortium: 220,
}

export const bottomPanelOpen = signal<boolean>(false)
export const bottomPanelTab = signal<BottomPanelTab>('budget')
export const bottomPanelHeights = signal<BottomPanelHeightPreferences>(createDefaultBottomPanelHeights())

export function createDefaultBottomPanelHeights(): BottomPanelHeightPreferences {
  return {
    timeline: null,
    budget: null,
    consortium: null,
  }
}

export function resolveBottomPanelHeight(
  tab: BottomPanelTab,
  heights: BottomPanelHeightPreferences = bottomPanelHeights.value,
): number {
  return heights[tab] ?? DEFAULT_BOTTOM_PANEL_HEIGHTS[tab]
}
