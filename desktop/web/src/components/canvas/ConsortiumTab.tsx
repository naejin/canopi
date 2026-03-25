import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, nonCanvasRevision } from '../../state/document'
import type { Consortium } from '../../types/design'
import { currentConsortiums } from '../../state/canvas'
import { canvasEngine } from '../../canvas/engine'
import { renderConsortiumBoundaries } from '../../canvas/consortium-visual'
import styles from './ConsortiumTab.module.css'

interface FormState {
  name: string
  plants: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  plants: '',
  notes: '',
}

export function ConsortiumTab() {
  void locale.value

  const showAddForm = useSignal(false)
  const editingIndex = useSignal<number | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })

  const consortiums = currentDesign.value?.consortiums ?? []

  function openAdd() {
    form.value = { ...EMPTY_FORM }
    editingIndex.value = null
    showAddForm.value = true
  }

  function openEdit(consortium: Consortium, index: number) {
    form.value = {
      name: consortium.name,
      plants: consortium.plant_ids.join(', '),
      notes: consortium.notes ?? '',
    }
    editingIndex.value = index
    showAddForm.value = true
  }

  function cancelForm() {
    showAddForm.value = false
    editingIndex.value = null
    form.value = { ...EMPTY_FORM }
  }

  function saveForm() {
    const design = currentDesign.value
    if (!design) return
    const f = form.value
    if (!f.name.trim()) return

    const plants = f.plants
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    const idx = editingIndex.value

    if (idx !== null) {
      const updated = [...design.consortiums]
      const existing = design.consortiums[idx]!
      updated[idx] = {
        id: existing.id,
        name: f.name.trim(),
        plant_ids: plants,
        notes: f.notes.trim() || null,
      }
      currentDesign.value = { ...design, consortiums: updated }
    } else {
      const newConsortium: Consortium = {
        id: crypto.randomUUID(),
        name: f.name.trim(),
        plant_ids: plants,
        notes: f.notes.trim() || null,
      }
      currentDesign.value = {
        ...design,
        consortiums: [...design.consortiums, newConsortium],
      }
    }

    nonCanvasRevision.value++
    _syncConsortiumVisuals()
    cancelForm()
  }

  function deleteConsortium(index: number) {
    const design = currentDesign.value
    if (!design) return
    currentDesign.value = {
      ...design,
      consortiums: design.consortiums.filter((_, i) => i !== index),
    }
    nonCanvasRevision.value++
    _syncConsortiumVisuals()
  }

  function _syncConsortiumVisuals() {
    const c = currentDesign.value?.consortiums ?? []
    currentConsortiums.value = c
    if (canvasEngine) renderConsortiumBoundaries(canvasEngine, c)
  }

  const isEditing = showAddForm.value

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAdd}
          aria-label={t('canvas.consortium.addConsortium')}
        >
          + {t('canvas.consortium.addConsortium')}
        </button>
      </div>

      {isEditing && (
        <div className={styles.formRow} role="form" aria-label={editingIndex.value !== null ? t('canvas.consortium.editConsortium') : t('canvas.consortium.addConsortium')}>
          <input
            type="text"
            className={styles.formInput}
            value={form.value.name}
            onInput={(e) => { form.value = { ...form.value, name: e.currentTarget.value } }}
            placeholder={t('canvas.consortium.namePlaceholder')}
            aria-label={t('canvas.consortium.name')}
          />
          <input
            type="text"
            className={`${styles.formInput} ${styles.formInputWide}`}
            value={form.value.plants}
            onInput={(e) => { form.value = { ...form.value, plants: e.currentTarget.value } }}
            placeholder={t('canvas.consortium.plantsPlaceholder')}
            aria-label={t('canvas.consortium.plants')}
          />
          <input
            type="text"
            className={`${styles.formInput} ${styles.formInputWide}`}
            value={form.value.notes}
            onInput={(e) => { form.value = { ...form.value, notes: e.currentTarget.value } }}
            placeholder={t('canvas.consortium.notesPlaceholder')}
            aria-label={t('canvas.consortium.notes')}
          />
          <button type="button" className={styles.saveBtn} onClick={saveForm}>
            {t('canvas.consortium.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm}>
            {t('canvas.consortium.cancel')}
          </button>
        </div>
      )}

      {consortiums.length === 0 && !isEditing ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.consortium.emptyState')}</p>
          <p className={styles.emptyHint}>{t('canvas.consortium.emptyHint')}</p>
          <button type="button" className={styles.emptyAddBtn} onClick={openAdd}>
            + {t('canvas.consortium.addConsortium')}
          </button>
        </div>
      ) : (
        <div className={styles.listWrapper}>
          {consortiums.map((c, i) => (
            <div key={`${c.name}-${i}`} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.cardName}>{c.name}</span>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.rowActionBtn}
                    onClick={() => openEdit(c, i)}
                    aria-label={t('canvas.consortium.editConsortium')}
                  >
                    {t('canvas.consortium.edit')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.rowActionBtn} ${styles.rowActionBtnDanger}`}
                    onClick={() => deleteConsortium(i)}
                    aria-label={t('canvas.consortium.deleteConsortium')}
                  >
                    {t('canvas.consortium.delete')}
                  </button>
                </div>
              </div>
              {c.plant_ids.length > 0 && (
                <div className={styles.plantChips}>
                  {c.plant_ids.map((p) => (
                    <span key={p} className={styles.plantChip}>
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {c.notes && (
                <p className={styles.cardNotes}>{c.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
