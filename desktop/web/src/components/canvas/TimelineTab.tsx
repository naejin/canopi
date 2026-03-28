import { useRef, useCallback } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision } from '../../state/document'
import { toISODate } from '../../canvas/timeline-math'
import type { TimelineAction } from '../../types/design'
import { InteractiveTimeline, type Granularity } from './InteractiveTimeline'
import styles from './TimelineTab.module.css'

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

type ActionType = 'planting' | 'pruning' | 'harvest' | 'watering' | 'fertilising' | 'other'
const ACTION_TYPES: ActionType[] = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']
const GRANULARITIES: Granularity[] = ['week', 'month', 'year']

function generateId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TimelineTab
// ---------------------------------------------------------------------------

export function TimelineTab() {
  void locale.value

  const granularity = useSignal<Granularity>('month')
  const selectedId = useSignal<string | null>(null)
  const showForm = useSignal(false)
  const editingId = useSignal<string | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })
  const scrollToTodayRef = useRef<(() => void) | null>(null)

  const actions = currentDesign.value?.timeline ?? []
  const hasActions = actions.length > 0

  // ---- Form handlers --------------------------------------------------------

  function openAdd() {
    const today = new Date()
    const todayStr = toISODate(today)
    const endStr = toISODate(new Date(today.getTime() + 14 * 86400000))

    form.value = {
      ...EMPTY_FORM,
      start_date: todayStr,
      end_date: endStr,
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
    const f = form.value
    if (!f.description.trim()) return

    const id = editingId.value

    if (id) {
      // Edit existing
      currentDesign.value = {
        ...design,
        timeline: design.timeline.map((a) =>
          a.id === id
            ? {
                ...a,
                action_type: f.action_type,
                description: f.description.trim(),
                start_date: f.start_date || null,
                end_date: f.end_date || null,
              }
            : a
        ),
      }
    } else {
      // Add new
      const newAction: TimelineAction = {
        id: generateId(),
        action_type: f.action_type,
        description: f.description.trim(),
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        recurrence: null,
        plants: null,
        zone: null,
        depends_on: null,
        completed: false,
        order: design.timeline.length,
      }
      currentDesign.value = {
        ...design,
        timeline: [...design.timeline, newAction],
      }
    }

    nonCanvasRevision.value++
    cancelForm()
  }

  // ---- Auto-populate --------------------------------------------------------

  function autoPopulate() {
    const design = currentDesign.value
    if (!design) return
    if (design.plants.length === 0) return

    const existing = new Set(design.timeline.map((a) => `${a.plants?.[0] ?? ''}-${a.action_type}`))
    const newActions: TimelineAction[] = []

    const now = new Date()
    const year = now.getFullYear()

    for (const plant of design.plants) {
      const key = plant.canonical_name

      // Planting action
      const plantingKey = `${key}-planting`
      if (!existing.has(plantingKey)) {
        newActions.push({
          id: generateId(),
          action_type: 'planting',
          description: `${t('canvas.timeline.type_planting')} - ${plant.common_name || plant.canonical_name}`,
          start_date: `${year}-03-15`,
          end_date: `${year}-04-15`,
          recurrence: null,
          plants: [key],
          zone: null,
          depends_on: null,
          completed: false,
          order: design.timeline.length + newActions.length,
        })
        existing.add(plantingKey)
      }

      // Harvest action
      const harvestKey = `${key}-harvest`
      if (!existing.has(harvestKey)) {
        newActions.push({
          id: generateId(),
          action_type: 'harvest',
          description: `${t('canvas.timeline.type_harvest')} - ${plant.common_name || plant.canonical_name}`,
          start_date: `${year}-08-01`,
          end_date: `${year}-09-30`,
          recurrence: null,
          plants: [key],
          zone: null,
          depends_on: null,
          completed: false,
          order: design.timeline.length + newActions.length,
        })
        existing.add(harvestKey)
      }
    }

    if (newActions.length === 0) return

    currentDesign.value = {
      ...design,
      timeline: [...design.timeline, ...newActions],
    }
    nonCanvasRevision.value++
  }

  // ---- Today scroll ---------------------------------------------------------

  function scrollToToday() {
    scrollToTodayRef.current?.()
  }

  // ---- Select handler -------------------------------------------------------

  const handleSelect = useCallback((id: string | null) => {
    selectedId.value = id
  }, [])

  // ---- Render ---------------------------------------------------------------

  const isEditing = showForm.value

  return (
    <div className={styles.container}>
      {/* Header toolbar */}
      <div className={styles.header}>
        {/* Granularity chips */}
        <div className={styles.chipGroup} role="radiogroup" aria-label={t('canvas.timeline.title')}>
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={granularity.value === g}
              className={`${styles.chip}${granularity.value === g ? ` ${styles.chipActive}` : ''}`}
              onClick={() => { granularity.value = g }}
            >
              {t(`canvas.timeline.${g}View`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.toolBtn}
          onClick={scrollToToday}
          aria-label={t('canvas.timeline.todayMarker')}
        >
          {t('canvas.timeline.todayMarker')}
        </button>

        <div className={styles.headerSpacer} />

        {hasActions && (
          <span className={styles.count}>
            {actions.filter((a) => a.completed).length} / {actions.length}
          </span>
        )}

        <button
          type="button"
          className={styles.toolBtn}
          onClick={autoPopulate}
          aria-label={t('canvas.timeline.prePopulate')}
        >
          {t('canvas.timeline.prePopulate')}
        </button>

        <button
          type="button"
          className={styles.addBtn}
          onClick={openAdd}
          aria-label={t('canvas.timeline.addAction')}
        >
          + {t('canvas.timeline.addAction')}
        </button>
      </div>

      {/* Inline edit/add form */}
      {isEditing && (
        <div className={styles.formRow} role="form" aria-label={editingId.value ? t('canvas.timeline.editAction') : t('canvas.timeline.addAction')}>
          <select
            className={styles.formSelect}
            value={form.value.action_type}
            onChange={(e) => { form.value = { ...form.value, action_type: (e.target as HTMLSelectElement).value } }}
            aria-label={t('canvas.timeline.actionType')}
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
            onInput={(e) => { form.value = { ...form.value, description: (e.target as HTMLInputElement).value } }}
            placeholder={t('canvas.timeline.description')}
            aria-label={t('canvas.timeline.description')}
          />
          <input
            type="date"
            className={styles.formDate}
            value={form.value.start_date}
            onInput={(e) => { form.value = { ...form.value, start_date: (e.target as HTMLInputElement).value } }}
            aria-label={t('canvas.timeline.startDate')}
          />
          <span className={styles.dateSep}>{'\u2192'}</span>
          <input
            type="date"
            className={styles.formDate}
            value={form.value.end_date}
            onInput={(e) => { form.value = { ...form.value, end_date: (e.target as HTMLInputElement).value } }}
            aria-label={t('canvas.timeline.endDate')}
          />
          <button type="button" className={styles.saveBtn} onClick={saveForm}>
            {t('canvas.timeline.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm}>
            {t('canvas.timeline.cancel')}
          </button>
        </div>
      )}

      {/* Main content area */}
      {!hasActions && !isEditing ? (
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
            onSelect={handleSelect}
            onEditRequest={openEdit}
            scrollToTodayRef={scrollToTodayRef}
          />
        </div>
      )}
    </div>
  )
}
