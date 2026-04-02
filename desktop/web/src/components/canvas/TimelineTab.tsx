import { useCallback, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import { currentCanvasSession } from '../../canvas/session'
import { toISODate } from '../../canvas/timeline-math'
import {
  addTimelineAction,
  appendAutoTimelineActions,
  buildDefaultTimelineActions,
  updateTimelineAction,
} from '../../state/timeline-actions'
import type { TimelineAction } from '../../types/design'
import { InteractiveTimeline, type Granularity } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

type ActionType = 'planting' | 'pruning' | 'harvest' | 'watering' | 'fertilising' | 'other'

const ACTION_TYPES: ActionType[] = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']
const GRANULARITIES: Granularity[] = ['week', 'month', 'year']

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
  void locale.value
  const session = currentCanvasSession.value

  const granularity = useSignal<Granularity>('month')
  const selectedId = useSignal<string | null>(null)
  const showForm = useSignal(false)
  const editingId = useSignal<string | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })
  const scrollToTodayRef = useRef<(() => void) | null>(null)

  const actions = currentDesign.value?.timeline ?? []
  const hasActions = actions.length > 0

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
    const design = currentDesign.value
    if (!design) return
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
        plants: null,
        zone: null,
        depends_on: null,
        completed: false,
        order: design.timeline.length,
      })
    }

    cancelForm()
  }

  function autoPopulate() {
    const design = currentDesign.value
    if (!design) return

    const plants = session?.getPlacedPlants() ?? design.plants
    const nextActions = buildDefaultTimelineActions(
      plants,
      design.timeline,
      t('canvas.timeline.type_planting'),
      t('canvas.timeline.type_harvest'),
    )
    appendAutoTimelineActions(nextActions)
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
        <button type="button" className={styles.toolBtn} onClick={autoPopulate}>
          {t('canvas.timeline.prePopulate')}
        </button>
        <div className={styles.headerSpacer} />
        {hasActions && <span className={styles.count}>{actions.length}</span>}
        <button type="button" className={styles.addBtn} onClick={openAdd}>
          + {t('canvas.timeline.addAction')}
        </button>
      </div>

      {showForm.value && (
        <div className={styles.formRow}>
          <select
            className={styles.formSelect}
            value={form.value.action_type}
            onChange={(event) => {
              form.value = { ...form.value, action_type: (event.target as HTMLSelectElement).value }
            }}
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`canvas.timeline.type_${type}`)}
              </option>
            ))}
          </select>
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
          <span className={styles.dateSep}>{'->'}</span>
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

      {!hasActions && !showForm.value ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.timeline.emptyState')}</p>
          <p className={styles.emptyHint}>{t('canvas.timeline.emptyHint')}</p>
          <button type="button" className={styles.emptyAddBtn} onClick={openAdd}>
            + {t('canvas.timeline.addAction')}
          </button>
        </div>
      ) : (
        <div className={styles.canvasArea}>
          <InteractiveTimeline
            granularity={granularity.value}
            selectedId={selectedId.value}
            onSelect={(id) => { selectedId.value = id }}
            onEditRequest={openEdit}
            scrollToTodayRef={scrollToTodayRef}
          />
        </div>
      )}
    </div>
  )
}
