import { signal } from '@preact/signals'
import type { BottomPanelTab } from '../canvas-settings/bottom-panel-state'
import type { PanelTarget } from '../../types/design'

export const hoveredPanelTargets = signal<readonly PanelTarget[]>([])
export const selectedPanelTargets = signal<readonly PanelTarget[]>([])
export const selectedPanelTargetOrigin = signal<BottomPanelTab | null>(null)
export const hoveredCanvasTargets = signal<readonly PanelTarget[]>([])
