import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale } from '../../app/shell/state'
import { ACTION_TYPES, actionColor } from '../../canvas/timeline-renderer'
import { DatePicker } from '../shared/DatePicker'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import styles from './TimelinePopover.module.css'

export interface PopoverFormData {
  action_type: string
  start_date: string
  end_date: string
  description: string
  species_canonical: string | null
}

interface TimelinePopoverProps {
  mode: 'add' | 'edit'
  anchorX: number
  anchorY: number
  initialData: PopoverFormData
  speciesList: Array<{ canonical_name: string; display_name: string }>
  onSave: (data: PopoverFormData) => void
  onDelete?: () => void
  onCancel: () => void
}

export function TimelinePopover({
  mode,
  anchorX,
  anchorY,
  initialData,
  speciesList,
  onSave,
  onDelete,
  onCancel,
}: TimelinePopoverProps) {
  void locale.value // subscribe to locale changes for t() reactivity
  const form = useSignal<PopoverFormData>({ ...initialData })
  const popoverRef = useRef<HTMLDivElement>(null)
  const posX = useSignal(anchorX)
  const posY = useSignal(anchorY)

  // Edge clamping after mount — flip above click point if no room below
  useEffect(() => {
    const el = popoverRef.current
    if (!el) return
    const popRect = el.getBoundingClientRect()
    let x = anchorX
    let y = anchorY
    // Flip to whichever direction has more room
    if (y + popRect.height > window.innerHeight) {
      const spaceAbove = anchorY
      const spaceBelow = window.innerHeight - anchorY
      if (spaceAbove > spaceBelow) {
        y = Math.max(4, anchorY - popRect.height - 4)
      } else {
        y = Math.max(4, window.innerHeight - popRect.height - 4)
      }
    }
    // Horizontal clamp to viewport
    if (x + popRect.width > window.innerWidth) x = window.innerWidth - popRect.width - 4
    if (x < 4) x = 4
    if (y < 4) y = 4
    posX.value = x
    posY.value = y
  }, [anchorX, anchorY])

  // Click-outside + Escape (in useEffect, not synchronous)
  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-preserve-overlays="true"]')) return
      onCancel()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  const speciesItems: DropdownItem<string | null>[] = [
    { value: null, label: t('canvas.timeline.speciesNone') },
    ...speciesList.map((s) => ({ value: s.canonical_name as string | null, label: s.display_name })),
  ]

  const dateError = useSignal<string | null>(null)

  const handleSave = () => {
    const f = form.value
    if (f.start_date && f.end_date && f.start_date > f.end_date) {
      dateError.value = t('canvas.timeline.dateError')
      return
    }
    onSave(f)
  }

  const updateField = <K extends keyof PopoverFormData>(key: K, value: PopoverFormData[K]) => {
    form.value = { ...form.value, [key]: value }
    if (dateError.peek()) dateError.value = null
  }

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ left: posX.value, top: posY.value }}
      data-preserve-overlays="true"
      role="dialog"
      aria-label={t(mode === 'add' ? 'canvas.timeline.addTitle' : 'canvas.timeline.editTitle')}
    >
      <div className={styles.title}>
        {t(mode === 'add' ? 'canvas.timeline.addTitle' : 'canvas.timeline.editTitle')}
      </div>

      <div className={styles.pills}>
        {ACTION_TYPES.map((type) => {
          const color = actionColor(type)
          const isActive = form.value.action_type === type
          return (
            <button
              key={type}
              type="button"
              className={styles.pill}
              style={isActive ? { background: color + '1F', borderColor: color, color } : undefined}
              onClick={() => updateField('action_type', type)}
            >
              {t(`canvas.timeline.type_${type}`)}
            </button>
          )
        })}
      </div>

      <div className={styles.fields}>
        <div className={styles.dateRow}>
          <span className={styles.label}>{t('canvas.timeline.startDate')}</span>
          <DatePicker
            value={form.value.start_date}
            onChange={(v) => updateField('start_date', v)}
            max={form.value.end_date || undefined}
            error={!!dateError.value}
            className={styles.input}
            preserveOverlays
            ariaLabel={t('canvas.timeline.startDate')}
          />
        </div>
        <div className={styles.dateRow}>
          <span className={styles.label}>{t('canvas.timeline.endDate')}</span>
          <DatePicker
            value={form.value.end_date}
            onChange={(v) => updateField('end_date', v)}
            min={form.value.start_date || undefined}
            error={!!dateError.value}
            className={styles.input}
            preserveOverlays
            ariaLabel={t('canvas.timeline.endDate')}
          />
        </div>
        {dateError.value && (
          <div className={styles.error}>{dateError.value}</div>
        )}
        <input
          type="text"
          className={styles.input}
          value={form.value.description}
          onInput={(e) => updateField('description', (e.target as HTMLInputElement).value)}
          placeholder={t('canvas.timeline.notes')}
        />
        {speciesList.length > 0 && (
          <div className={styles.speciesRow}>
            <span className={styles.label}>{t('canvas.timeline.species')}</span>
            <Dropdown
              trigger={
                speciesList.find((s) => s.canonical_name === form.value.species_canonical)?.display_name
                ?? t('canvas.timeline.speciesNone')
              }
              items={speciesItems}
              value={form.value.species_canonical}
              onChange={(value) => updateField('species_canonical', value)}
              ariaLabel={t('canvas.timeline.species')}
              menuDirection="down"
              preserveOverlays
            />
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {mode === 'edit' && onDelete && (
          <button type="button" className={styles.btnDelete} onClick={onDelete}>
            {t('canvas.timeline.delete')}
          </button>
        )}
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>
          {t('canvas.timeline.cancel')}
        </button>
        <button type="button" className={styles.btnPrimary} onClick={handleSave}>
          {t(mode === 'add' ? 'canvas.timeline.add' : 'canvas.timeline.save')}
        </button>
      </div>
    </div>
  )
}
