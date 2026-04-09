import { useCallback, useEffect } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import { currentDesign } from '../../state/document'
import type { TimelineAction } from '../../types/design'
import { InteractiveTimeline, clearTimelineSelectedPanelTargets } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

const EMPTY_TIMELINE: TimelineAction[] = []

export function TimelineTab() {
  const selectedId = useSignal<string | null>(null)

  useSignalEffect(() => {
    const id = selectedId.value
    if (!id) return
    const actions = currentDesign.value?.timeline ?? EMPTY_TIMELINE
    if (actions.some((action) => action.id === id)) return
    selectedId.value = null
    clearTimelineSelectedPanelTargets()
  })

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
