import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { selectedPanelTargetOrigin, selectedPanelTargets } from '../../state/canvas'
import { currentDesign } from '../../state/document'
import { toISODate } from '../../canvas/timeline-math'
import { ACTION_TYPES } from '../../canvas/timeline-renderer'
import {
  addTimelineAction,
  updateTimelineAction,
} from '../../state/timeline-actions'
import { MANUAL_TARGET } from '../../panel-targets'
import type { TimelineAction } from '../../types/design'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import { InteractiveTimeline, type Granularity } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

const EMPTY_TIMELINE: TimelineAction[] = []
const EMPTY_PANEL_TARGETS = [] as const

function clearTimelineSelectedPanelTargets(): void {
  if (selectedPanelTargetOrigin.peek() !== 'timeline') return
  if (selectedPanelTargets.peek().length > 0) selectedPanelTargets.value = EMPTY_PANEL_TARGETS
  selectedPanelTargetOrigin.value = null
}

const GRANULARITIES: Granularity[] = ['month', 'year']

interface FormState {
  action_type: string
  description: string
  start_date: string
  end_date: string
}

const EMPTY_FORM: FormState = {
  action_type: 'planting',
  description: '',
  start_date: '',
  end_date: '',
}

export function TimelineTab() {
  const granularity = useSignal<Granularity>('month')
  const selectedId = useSignal<string | null>(null)
  const showForm = useSignal(false)
  const editingId = useSignal<string | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })
  const scrollToTodayRef = useRef<(() => void) | null>(null)

  const actionTypeItems: DropdownItem<string>[] = useMemo(
    () => ACTION_TYPES.map((type) => ({ value: type, label: t(`canvas.timeline.type_${type}`) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale.value],
  )

  const actions = currentDesign.value?.timeline ?? EMPTY_TIMELINE

  useEffect(() => {
    if (!selectedId.value) return
    if (actions.some((action) => action.id === selectedId.value)) return
    selectedId.value = null
    clearTimelineSelectedPanelTargets()
  }, [actions, selectedId.value])

  useEffect(() => clearTimelineSelectedPanelTargets, [])

  function openAdd() {
    const today = new Date()
    form.value = {
      ...EMPTY_FORM,
      start_date: toISODate(today),
      end_date: toISODate(new Date(today.getTime() + 14 * 86400000)),
    }
    editingId.value = null
    showForm.value = true
  }

  const handleSelect = useCallback((id: string | null) => { selectedId.value = id }, [])

  const openEdit = useCallback((action: TimelineAction) => {
    form.value = {
      action_type: action.action_type,
      description: action.description,
      start_date: action.start_date ?? '',
      end_date: action.end_date ?? '',
    }
    editingId.value = action.id
    showForm.value = true
  }, [])

  function cancelForm() {
    showForm.value = false
    editingId.value = null
    form.value = { ...EMPTY_FORM }
  }

  function saveForm() {
    const next = form.value
    if (!next.description.trim()) return

    if (editingId.value) {
      updateTimelineAction(editingId.value, {
        action_type: next.action_type,
        description: next.description.trim(),
        start_date: next.start_date || null,
        end_date: next.end_date || null,
      })
    } else {
      addTimelineAction({
        id: crypto.randomUUID(),
        action_type: next.action_type,
        description: next.description.trim(),
        start_date: next.start_date || null,
        end_date: next.end_date || null,
        recurrence: null,
        targets: [MANUAL_TARGET],
        depends_on: null,
        completed: false,
      })
    }

    cancelForm()
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.chipGroup} role="radiogroup" aria-label={t('canvas.timeline.title')}>
          {GRANULARITIES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={granularity.value === value}
              className={`${styles.chip} ${granularity.value === value ? styles.chipActive : ''}`}
              onClick={() => { granularity.value = value }}
            >
              {t(`canvas.timeline.${value}View`)}
            </button>
          ))}
        </div>

        <button type="button" className={styles.toolBtn} onClick={() => scrollToTodayRef.current?.()}>
          {t('canvas.timeline.todayMarker')}
        </button>
        <div className={styles.headerSpacer} />
        {actions.length > 0 && <span className={styles.count}>{actions.length}</span>}
        <button type="button" className={styles.addBtn} onClick={openAdd}>
          + {t('canvas.timeline.addAction')}
        </button>
      </div>

      {showForm.value && (
        <div className={styles.formRow}>
          <Dropdown
            trigger={t(`canvas.timeline.type_${form.value.action_type}`)}
            items={actionTypeItems}
            value={form.value.action_type}
            onChange={(value) => { form.value = { ...form.value, action_type: value } }}
            ariaLabel={t('canvas.timeline.actionType')}
            menuDirection="down"
            triggerClassName={styles.formSelect}
          />
          <input
            type="text"
            className={styles.formInput}
            value={form.value.description}
            onInput={(event) => {
              form.value = { ...form.value, description: (event.target as HTMLInputElement).value }
            }}
            placeholder={t('canvas.timeline.description')}
          />
          <input
            type="date"
            className={styles.formDate}
            value={form.value.start_date}
            onInput={(event) => {
              form.value = { ...form.value, start_date: (event.target as HTMLInputElement).value }
            }}
          />
          <span className={styles.dateSep}>{'\u2192'}</span>
          <input
            type="date"
            className={styles.formDate}
            value={form.value.end_date}
            onInput={(event) => {
              form.value = { ...form.value, end_date: (event.target as HTMLInputElement).value }
            }}
          />
          <button type="button" className={styles.saveBtn} onClick={saveForm}>
            {t('canvas.timeline.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm}>
            {t('canvas.timeline.cancel')}
          </button>
        </div>
      )}

      <div className={styles.canvasArea}>
        <InteractiveTimeline
          granularity={granularity.value}
          selectedId={selectedId.value}
          onSelect={handleSelect}
          onEditRequest={openEdit}
          scrollToTodayRef={scrollToTodayRef}
        />
      </div>
    </div>
  )
}
