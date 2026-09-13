import { signal } from '@preact/signals'
import type { PanelTarget } from '../../types/design'

export type PanelTargetPresentationOrigin = 'timeline' | 'budget' | 'consortium'

export const hoveredPanelTargets = signal<readonly PanelTarget[]>([])
export const selectedPanelTargets = signal<readonly PanelTarget[]>([])
export const selectedPanelTargetOrigin = signal<PanelTargetPresentationOrigin | null>(null)
export const hoveredCanvasTargets = signal<readonly PanelTarget[]>([])
