import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { selectedPanelTargetOrigin, selectedPanelTargets } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import type { TimelineAction } from '../../types/design'
import { InteractiveTimeline } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

const EMPTY_TIMELINE: TimelineAction[] = []
const EMPTY_PANEL_TARGETS = [] as const

function clearTimelineSelectedPanelTargets(): void {
  if (selectedPanelTargetOrigin.peek() !== 'timeline') return
  if (selectedPanelTargets.peek().length > 0) selectedPanelTargets.value = EMPTY_PANEL_TARGETS
  selectedPanelTargetOrigin.value = null
}

export function TimelineTab() {
  const selectedId = useSignal<string | null>(null)
  const actions = currentDesign.value?.timeline ?? EMPTY_TIMELINE

  useEffect(() => {
    if (!selectedId.value) return
    if (actions.some((action) => action.id === selectedId.value)) return
    selectedId.value = null
    clearTimelineSelectedPanelTargets()
  }, [actions, selectedId.value])

  useEffect(() => clearTimelineSelectedPanelTargets, [])

  const handleSelect = useCallback((id: string | null) => { selectedId.value = id }, [])

  return (
    <div className={styles.container}>
      <div className={styles.canvasArea}>
        <InteractiveTimeline
          selectedId={selectedId.value}
          onSelect={handleSelect}
        />
      </div>
    </div>
  )
}
