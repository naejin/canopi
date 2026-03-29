import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign } from '../../state/document'
import { deleteConsortium, upsertConsortium } from '../../state/consortium-actions'
import type { Consortium } from '../../types/design'
import {
  buildPlantLookup,
  describePlantToken,
  formatPlantTokenForEdit,
  resolvePlantTokens,
} from './consortium-tokens'
import styles from './ConsortiumTab.module.css'

interface ConsortiumFormState {
  name: string
  plants: string
  notes: string
}

const EMPTY_FORM: ConsortiumFormState = {
  name: '',
  plants: '',
  notes: '',
}

export function ConsortiumTab() {
  void locale.value

  const showForm = useSignal(false)
  const editingId = useSignal<string | null>(null)
  const form = useSignal<ConsortiumFormState>({ ...EMPTY_FORM })

  const design = currentDesign.value
  const plants = design?.plants ?? []
  const consortiums = design?.consortiums ?? []
  const plantLookup = buildPlantLookup(plants)

  function openAdd() {
    showForm.value = true
    editingId.value = null
    form.value = { ...EMPTY_FORM }
  }

  function openEdit(consortium: Consortium) {
    showForm.value = true
    editingId.value = consortium.id
    form.value = {
      name: consortium.name,
      plants: consortium.plant_ids
        .map((plantId) => formatPlantTokenForEdit(plantId, plantLookup))
        .join(', '),
      notes: consortium.notes ?? '',
    }
  }

  function cancelForm() {
    showForm.value = false
    editingId.value = null
    form.value = { ...EMPTY_FORM }
  }

  function saveForm() {
    const name = form.value.name.trim()
    if (!name) return

    upsertConsortium({
      id: editingId.value ?? crypto.randomUUID(),
      name,
      plant_ids: resolvePlantTokens(form.value.plants, plants),
      notes: form.value.notes.trim() || null,
    })

    cancelForm()
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{t('canvas.bottomPanel.consortium')}</span>
        <button type="button" className={styles.addBtn} onClick={openAdd}>
          + {t('canvas.consortium.addConsortium')}
        </button>
      </div>

      {showForm.value && (
        <div className={styles.formRow}>
          <input
            type="text"
            className={styles.formInput}
            value={form.value.name}
            onInput={(event) => {
              form.value = { ...form.value, name: event.currentTarget.value }
            }}
            placeholder={t('canvas.consortium.namePlaceholder')}
          />
          <input
            type="text"
            className={`${styles.formInput} ${styles.formInputWide}`}
            value={form.value.plants}
            onInput={(event) => {
              form.value = { ...form.value, plants: event.currentTarget.value }
            }}
            placeholder={t('canvas.consortium.plantsPlaceholder')}
          />
          <input
            type="text"
            className={`${styles.formInput} ${styles.formInputWide}`}
            value={form.value.notes}
            onInput={(event) => {
              form.value = { ...form.value, notes: event.currentTarget.value }
            }}
            placeholder={t('canvas.consortium.notesPlaceholder')}
          />
          <button type="button" className={styles.saveBtn} onClick={saveForm}>
            {t('canvas.consortium.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm}>
            {t('canvas.consortium.cancel')}
          </button>
        </div>
      )}

      {consortiums.length === 0 && !showForm.value ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.consortium.emptyState')}</p>
          <p className={styles.emptyHint}>{t('canvas.consortium.emptyHint')}</p>
          <button type="button" className={styles.emptyAddBtn} onClick={openAdd}>
            + {t('canvas.consortium.addConsortium')}
          </button>
        </div>
      ) : (
        <div className={styles.listWrapper}>
          {consortiums.map((consortium) => (
            <article key={consortium.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.cardName}>{consortium.name}</div>
                <div className={styles.cardActions}>
                  <button type="button" className={styles.rowActionBtn} onClick={() => openEdit(consortium)}>
                    {t('canvas.consortium.edit')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.rowActionBtn} ${styles.rowActionBtnDanger}`}
                    onClick={() => deleteConsortium(consortium.id)}
                  >
                    {t('canvas.consortium.delete')}
                  </button>
                </div>
              </div>

              <div className={styles.plantChips}>
                {consortium.plant_ids.map((plantId) => (
                  <span key={plantId} className={styles.plantChip}>
                    {describePlantToken(plantId, plantLookup)}
                  </span>
                ))}
              </div>

              {consortium.notes && <p className={styles.cardNotes}>{consortium.notes}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
