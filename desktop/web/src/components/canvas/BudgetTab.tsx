import { useSignal, computed } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { currentDesign, designDirty } from '../../state/design'
import type { BudgetItem } from '../../types/design'
import styles from './BudgetTab.module.css'

type BudgetCategory = 'plants' | 'materials' | 'labor' | 'tools' | 'other'

const CATEGORIES: BudgetCategory[] = ['plants', 'materials', 'labor', 'tools', 'other']

interface FormState {
  category: string
  description: string
  quantity: string
  unit_cost: string
  currency: string
}

const EMPTY_FORM: FormState = {
  category: 'plants',
  description: '',
  quantity: '1',
  unit_cost: '0',
  currency: 'EUR',
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function BudgetTab() {
  void locale.value

  const showAddForm = useSignal(false)
  const editingIndex = useSignal<number | null>(null)
  const form = useSignal<FormState>({ ...EMPTY_FORM })

  const items = currentDesign.value?.budget ?? []

  const grandTotal = computed(() => {
    const design = currentDesign.value
    if (!design) return 0
    return design.budget.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  })

  const defaultCurrency = items[0]?.currency ?? 'EUR'

  function openAdd() {
    form.value = { ...EMPTY_FORM, currency: defaultCurrency }
    editingIndex.value = null
    showAddForm.value = true
  }

  function openEdit(item: BudgetItem, index: number) {
    form.value = {
      category: item.category,
      description: item.description,
      quantity: String(item.quantity),
      unit_cost: String(item.unit_cost),
      currency: item.currency,
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
    if (!f.description.trim()) return

    const quantity = parseFloat(f.quantity) || 0
    const unit_cost = parseFloat(f.unit_cost) || 0

    const idx = editingIndex.value

    if (idx !== null) {
      const updated = [...design.budget]
      updated[idx] = {
        category: f.category,
        description: f.description.trim(),
        quantity,
        unit_cost,
        currency: f.currency,
      }
      currentDesign.value = { ...design, budget: updated }
    } else {
      const newItem: BudgetItem = {
        category: f.category,
        description: f.description.trim(),
        quantity,
        unit_cost,
        currency: f.currency,
      }
      currentDesign.value = {
        ...design,
        budget: [...design.budget, newItem],
      }
    }

    designDirty.value = true
    cancelForm()
  }

  function deleteItem(index: number) {
    const design = currentDesign.value
    if (!design) return
    currentDesign.value = {
      ...design,
      budget: design.budget.filter((_, i) => i !== index),
    }
    designDirty.value = true
  }

  const isEditing = showAddForm.value

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {items.length > 0 && (
          <span className={styles.total} aria-live="polite">
            {t('canvas.budget.total')}: {formatCurrency(grandTotal.value, defaultCurrency)}
          </span>
        )}
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAdd}
          aria-label={t('canvas.budget.addItem')}
        >
          + {t('canvas.budget.addItem')}
        </button>
      </div>

      {isEditing && (
        <div className={styles.formRow} role="form" aria-label={editingIndex.value !== null ? t('canvas.budget.editItem') : t('canvas.budget.addItem')}>
          <select
            className={styles.formSelect}
            value={form.value.category}
            onChange={(e) => { form.value = { ...form.value, category: e.currentTarget.value } }}
            aria-label={t('canvas.budget.category')}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t(`canvas.budget.category_${cat}`)}
              </option>
            ))}
          </select>
          <input
            type="text"
            className={`${styles.formInput} ${styles.formInputWide}`}
            value={form.value.description}
            onInput={(e) => { form.value = { ...form.value, description: e.currentTarget.value } }}
            placeholder={t('canvas.budget.description')}
            aria-label={t('canvas.budget.description')}
          />
          <input
            type="number"
            className={styles.formNumber}
            value={form.value.quantity}
            min="0"
            step="1"
            onInput={(e) => { form.value = { ...form.value, quantity: e.currentTarget.value } }}
            aria-label={t('canvas.budget.quantity')}
          />
          <input
            type="number"
            className={styles.formNumber}
            value={form.value.unit_cost}
            min="0"
            step="0.01"
            onInput={(e) => { form.value = { ...form.value, unit_cost: e.currentTarget.value } }}
            aria-label={t('canvas.budget.unitCost')}
          />
          <select
            className={styles.formSelectSm}
            value={form.value.currency}
            onChange={(e) => { form.value = { ...form.value, currency: e.currentTarget.value } }}
            aria-label={t('canvas.budget.currency')}
          >
            {['EUR', 'USD', 'GBP', 'BRL', 'CAD', 'CHF', 'CNY'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="button" className={styles.saveBtn} onClick={saveForm}>
            {t('canvas.budget.save')}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={cancelForm}>
            {t('canvas.budget.cancel')}
          </button>
        </div>
      )}

      {items.length === 0 && !isEditing ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('canvas.budget.emptyState')}</p>
          <p className={styles.emptyHint}>{t('canvas.budget.emptyHint')}</p>
          <button type="button" className={styles.emptyAddBtn} onClick={openAdd}>
            + {t('canvas.budget.addItem')}
          </button>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCat}>{t('canvas.budget.category')}</th>
                <th className={styles.thDesc}>{t('canvas.budget.description')}</th>
                <th className={styles.thNum}>{t('canvas.budget.quantity')}</th>
                <th className={styles.thNum}>{t('canvas.budget.unitCost')}</th>
                <th className={styles.thNum}>{t('canvas.budget.lineTotal')}</th>
                <th className={styles.thActions} />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={`${item.description}-${i}`}>
                  <td className={styles.tdCat}>
                    <span className={`${styles.badge} ${styles[`badge_${item.category}`] ?? ''}`}>
                      {t(`canvas.budget.category_${item.category}`, { defaultValue: item.category })}
                    </span>
                  </td>
                  <td className={styles.tdDesc}>{item.description}</td>
                  <td className={styles.tdNum}>{item.quantity}</td>
                  <td className={styles.tdNum}>{formatCurrency(item.unit_cost, item.currency)}</td>
                  <td className={styles.tdNum}>{formatCurrency(item.quantity * item.unit_cost, item.currency)}</td>
                  <td className={styles.tdRowActions}>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => openEdit(item, i)}
                      aria-label={t('canvas.budget.editItem')}
                    >
                      {t('canvas.budget.edit')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.rowActionBtn} ${styles.rowActionBtnDanger}`}
                      onClick={() => deleteItem(i)}
                      aria-label={t('canvas.budget.deleteItem')}
                    >
                      {t('canvas.budget.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className={styles.totalRow}>
                  <td colSpan={4} className={styles.totalLabel}>{t('canvas.budget.grandTotal')}</td>
                  <td className={styles.tdNum} aria-live="polite">
                    {formatCurrency(grandTotal.value, defaultCurrency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
