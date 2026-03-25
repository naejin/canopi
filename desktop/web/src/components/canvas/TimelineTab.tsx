import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision } from '../../state/document'
import type { TimelineAction } from '../../types/design'
import styles from './TimelineTab.module.css'

type ActionType = 'planting' | 'pruning' | 'harvest' | 'watering' | 'fertilising' | 'other'

const ACTION_TYPES: ActionType[] = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']

function generateId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

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

  const showAddForm = useSignal(false)
  const editingId = useSignal<string | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })

  const actions = currentDesign.value?.timeline ?? []

  function openAdd() {
    form.value = { ...EMPTY_FORM }
    editingId.value = null
    showAddForm.value = true
  }

  function openEdit(action: TimelineAction) {
    form.value = {
      action_type: action.action_type,
      description: action.description,
      start_date: action.start_date ?? '',
      end_date: action.end_date ?? '',
    }
    editingId.value = action.id
    showAddForm.value = true
  }

  function cancelForm() {
    showAddForm.value = false
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

  function toggleCompleted(id: string) {
    const design = currentDesign.value
    if (!design) return
    currentDesign.value = {
      ...design,
      timeline: design.timeline.map((a) =>
        a.id === id ? { ...a, completed: !a.completed } : a
      ),
    }
    nonCanvasRevision.value++
  }

  function deleteAction(id: string) {
    const design = currentDesign.value
    if (!design) return
    currentDesign.value = {
      ...design,
      timeline: design.timeline.filter((a) => a.id !== id),
    }
    nonCanvasRevision.value++
  }

  const isEditing = showAddForm.value

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.count}>
          {actions.length > 0
            ? `${actions.filter((a) => a.completed).length} / ${actions.length}`
            : ''}
        </span>
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAdd}
          aria-label={t('canvas.timeline.addAction')}
        >
          + {t('canvas.timeline.addAction')}
        </button>
      </div>

      {isEditing && (
        <div className={styles.formRow} role="form" aria-label={editingId.value ? t('canvas.timeline.editAction') : t('canvas.timeline.addAction')}>
          <select
            className={styles.formSelect}
            value={form.value.action_type}
            onChange={(e) => { form.value = { ...form.value, action_type: e.currentTarget.value } }}
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
            onInput={(e) => { form.value = { ...form.value, description: e.currentTarget.value } }}
            placeholder={t('canvas.timeline.description')}
            aria-label={t('canvas.timeline.description')}
          />
          <input
            type="date"
            className={styles.formDate}
            value={form.value.start_date}
            onInput={(e) => { form.value = { ...form.value, start_date: e.currentTarget.value } }}
            aria-label={t('canvas.timeline.startDate')}
          />
          <span className={styles.dateSep}>→</span>
          <input
            type="date"
            className={styles.formDate}
            value={form.value.end_date}
            onInput={(e) => { form.value = { ...form.value, end_date: e.currentTarget.value } }}
            aria-label={t('canvas.timeline.endDate')}
          />
          <button type="button" className={styles.saveBtn} onClick={saveForm} aria-label={t('canvas.timeline.save')}>
            {t('canvas.timeline.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm} aria-label={t('canvas.timeline.cancel')}>
            {t('canvas.timeline.cancel')}
          </button>
        </div>
      )}

      {actions.length === 0 && !isEditing ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.timeline.emptyState')}</p>
          <p className={styles.emptyHint}>{t('canvas.timeline.emptyHint')}</p>
          <button type="button" className={styles.emptyAddBtn} onClick={openAdd}>
            + {t('canvas.timeline.addAction')}
          </button>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCheck}>{t('canvas.timeline.completed')}</th>
                <th className={styles.thType}>{t('canvas.timeline.actionType')}</th>
                <th className={styles.thDesc}>{t('canvas.timeline.description')}</th>
                <th className={styles.thDate}>{t('canvas.timeline.startDate')}</th>
                <th className={styles.thDate}>{t('canvas.timeline.endDate')}</th>
                <th className={styles.thActions} />
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.id} className={action.completed ? styles.rowCompleted : ''}>
                  <td className={styles.tdCheck}>
                    <input
                      type="checkbox"
                      checked={action.completed}
                      onChange={() => toggleCompleted(action.id)}
                      aria-label={t('canvas.timeline.toggleCompleted')}
                      className={styles.checkbox}
                    />
                  </td>
                  <td className={styles.tdType}>
                    <span className={`${styles.badge} ${styles[`badge_${action.action_type}`] ?? ''}`}>
                      {t(`canvas.timeline.type_${action.action_type}`, { defaultValue: action.action_type })}
                    </span>
                  </td>
                  <td className={styles.tdDesc}>{action.description}</td>
                  <td className={styles.tdDate}>{action.start_date ?? '—'}</td>
                  <td className={styles.tdDate}>{action.end_date ?? '—'}</td>
                  <td className={styles.tdRowActions}>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => openEdit(action)}
                      aria-label={t('canvas.timeline.editAction')}
                    >
                      {t('canvas.timeline.edit')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.rowActionBtn} ${styles.rowActionBtnDanger}`}
                      onClick={() => deleteAction(action.id)}
                      aria-label={t('canvas.timeline.deleteAction')}
                    >
                      {t('canvas.timeline.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
