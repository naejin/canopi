import { signal } from '@preact/signals'

export type BottomPanelTab = 'timeline' | 'budget' | 'consortium'

export const VISIBLE_BOTTOM_PANEL_TABS: BottomPanelTab[] = ['timeline', 'budget', 'consortium']

export const bottomPanelOpen = signal<boolean>(false)
export const bottomPanelTab = signal<BottomPanelTab>('budget')
export const bottomPanelHeight = signal<number>(200)
