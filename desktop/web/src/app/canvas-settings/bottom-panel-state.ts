import { signal } from '@preact/signals'
import { DEFAULT_SETTINGS } from '../../generated/settings'

export type BottomPanelTab = 'timeline' | 'budget' | 'consortium'
export type BottomPanelHeightPreferences = Record<BottomPanelTab, number | null>

export const VISIBLE_BOTTOM_PANEL_TABS: BottomPanelTab[] = ['timeline', 'budget', 'consortium']
export const MIN_BOTTOM_PANEL_HEIGHT = 140
export const DEFAULT_BOTTOM_PANEL_HEIGHTS: Record<BottomPanelTab, number> = {
  timeline: 224,
  budget: 224,
  consortium: 220,
}

export const bottomPanelOpen = signal<boolean>(DEFAULT_SETTINGS.bottom_panel_open)
export const bottomPanelTab = signal<BottomPanelTab>(
  DEFAULT_SETTINGS.bottom_panel_tab as BottomPanelTab,
)
export const bottomPanelHeights = signal<BottomPanelHeightPreferences>(createDefaultBottomPanelHeights())

export function createDefaultBottomPanelHeights(): BottomPanelHeightPreferences {
  return {
    timeline: DEFAULT_SETTINGS.bottom_panel_timeline_height,
    budget: DEFAULT_SETTINGS.bottom_panel_budget_height,
    consortium: DEFAULT_SETTINGS.bottom_panel_consortium_height,
  }
}

export function resolveBottomPanelHeight(
  tab: BottomPanelTab,
  heights: BottomPanelHeightPreferences = bottomPanelHeights.value,
): number {
  return heights[tab] ?? DEFAULT_BOTTOM_PANEL_HEIGHTS[tab]
}
