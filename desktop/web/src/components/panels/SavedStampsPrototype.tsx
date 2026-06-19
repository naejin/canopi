/**
 * PROTOTYPE - delete or fold into FavoritesPanel after choosing a direction.
 * Three Saved Object Stamp UI variants, switchable via `?stampPrototype=A|B|C`,
 * mounted inside the existing Favorites side panel.
 */
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { SavedObjectStamp } from '../../types/saved-object-stamps'
import styles from './SavedStampsPrototype.module.css'

const PARAM = 'stampPrototype'
const VARIANTS = ['A', 'B', 'C'] as const

type StampPrototypeVariant = typeof VARIANTS[number]

interface StampPrototypeRow {
  readonly id: string
  readonly name: string
  readonly plants: number
  readonly zones: number
  readonly annotations: number
  readonly code: string
  readonly density: 'small' | 'medium' | 'large'
}

interface SavedStampsPrototypeProps {
  readonly stamps: readonly SavedObjectStamp[]
}

const SAMPLE_ROWS: readonly StampPrototypeRow[] = [
  {
    id: 'prototype-guild-1',
    name: 'Comfrey, Lemon balm, Fava',
    plants: 74,
    zones: 8,
    annotations: 4,
    code: 'ST-01',
    density: 'large',
  },
  {
    id: 'prototype-guild-2',
    name: 'Kitchen guild',
    plants: 9,
    zones: 2,
    annotations: 1,
    code: 'ST-02',
    density: 'medium',
  },
  {
    id: 'prototype-guild-3',
    name: 'Berry edge',
    plants: 12,
    zones: 3,
    annotations: 2,
    code: 'ST-03',
    density: 'small',
  },
]

const VARIANT_LABELS: Record<StampPrototypeVariant, string> = {
  A: 'Rail row',
  B: 'Ledger strip',
  C: 'Shelf label',
}

export function shouldShowSavedStampsPrototype(): boolean {
  return import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has(PARAM)
}

export function SavedStampsPrototype({ stamps }: SavedStampsPrototypeProps) {
  const rows = useMemo(() => prototypeRowsFromStamps(stamps), [stamps])
  const [variant, setVariantState] = useState<StampPrototypeVariant>(() => readVariant())
  const [selectedId, setSelectedId] = useState<string>(rows[0]?.id ?? '')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [lastAction, setLastAction] = useState('loaded')

  useEffect(() => {
    if (rows.length > 0 && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]!.id)
    }
  }, [rows, selectedId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setVariant(previousVariant(variant))
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setVariant(nextVariant(variant))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [variant])

  function setVariant(next: StampPrototypeVariant): void {
    writeVariant(next)
    setVariantState(next)
    setLastAction(`variant ${next}`)
  }

  function nameFor(row: StampPrototypeRow): string {
    return draftNames[row.id] ?? row.name
  }

  function setName(row: StampPrototypeRow, value: string): void {
    setDraftNames((current) => ({ ...current, [row.id]: value }))
    setLastAction(`rename ${row.code}`)
  }

  function select(row: StampPrototypeRow, action: string): void {
    setSelectedId(row.id)
    setLastAction(`${action} ${row.code}`)
  }

  function confirmDelete(row: StampPrototypeRow): void {
    setDeleteId(row.id)
    select(row, 'confirm delete')
  }

  function cancelDelete(): void {
    setLastAction('cancel delete')
    setDeleteId(null)
  }

  function markDeleted(row: StampPrototypeRow): void {
    setDeleteId(null)
    select(row, 'would delete')
  }

  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0]
  const commonProps = {
    rows,
    selectedId,
    editingId,
    deleteId,
    nameFor,
    setName,
    select,
    setEditingId,
    confirmDelete,
    cancelDelete,
    markDeleted,
  }

  return (
    <section className={styles.prototypeSection} aria-labelledby="saved-object-stamps-prototype-title">
      <div className={styles.prototypeHeader}>
        <div className={styles.prototypeTitleGroup}>
          <span id="saved-object-stamps-prototype-title" className={styles.prototypeTitle}>
            Saved Stamps
          </span>
          <span className={styles.prototypeDescription}>
            Prototype: evaluate stamp rows in the real Favorites panel.
          </span>
        </div>
        <span className={styles.prototypeCount}>{rows.length}</span>
      </div>

      <div className={styles.prototypeTopActions}>
        <button type="button" className={styles.prototypePrimary} onClick={() => setLastAction('save selection')}>
          Save selection
        </button>
        <button type="button" className={styles.prototypeSecondary} onClick={() => setLastAction('import')}>
          Import
        </button>
      </div>

      {variant === 'A' && <VariantRail {...commonProps} />}
      {variant === 'B' && <VariantLedger {...commonProps} />}
      {variant === 'C' && <VariantShelf {...commonProps} />}

      <div className={styles.prototypeState}>
        <span>variant {variant}</span>
        <span>{selectedRow ? selectedRow.code : 'none'}</span>
        <span>{lastAction}</span>
      </div>

      <PrototypeSwitcher variant={variant} setVariant={setVariant} />
    </section>
  )
}

interface VariantProps {
  readonly rows: readonly StampPrototypeRow[]
  readonly selectedId: string
  readonly editingId: string | null
  readonly deleteId: string | null
  readonly nameFor: (row: StampPrototypeRow) => string
  readonly setName: (row: StampPrototypeRow, value: string) => void
  readonly select: (row: StampPrototypeRow, action: string) => void
  readonly setEditingId: (id: string | null) => void
  readonly confirmDelete: (row: StampPrototypeRow) => void
  readonly cancelDelete: () => void
  readonly markDeleted: (row: StampPrototypeRow) => void
}

function VariantRail(props: VariantProps) {
  return (
    <div className={styles.railList} role="list" aria-label="Saved stamp rail prototype">
      {props.rows.map((row) => (
        <article
          key={row.id}
          className={`${styles.railRow} ${props.selectedId === row.id ? styles.selectedRow : ''}`}
          role="listitem"
          onClick={() => props.select(row, 'select')}
        >
          <button type="button" className={styles.dragGrip} aria-label="Reorder stamp">
            <GripIcon />
          </button>
          <MiniPlan row={row} />
          <div className={styles.railIdentity}>
            <EditableName row={row} variantProps={props} className={styles.prototypeName} />
            <span className={styles.prototypeSummary}>{summary(row)}</span>
            <ObjectTrail row={row} />
          </div>
          <ActionRail row={row} variantProps={props} tone="rail" />
        </article>
      ))}
    </div>
  )
}

function VariantLedger(props: VariantProps) {
  return (
    <div className={styles.ledger} role="list" aria-label="Saved stamp ledger prototype">
      {props.rows.map((row) => (
        <article
          key={row.id}
          className={`${styles.ledgerRow} ${props.selectedId === row.id ? styles.selectedRow : ''}`}
          role="listitem"
          onClick={() => props.select(row, 'select')}
        >
          <span className={styles.ledgerCode}>{row.code}</span>
          <div className={styles.ledgerMain}>
            <EditableName row={row} variantProps={props} className={styles.prototypeName} />
            <span className={styles.prototypeSummary}>{summary(row)}</span>
          </div>
          <Metric value={row.plants} label="P" />
          <Metric value={row.zones} label="Z" />
          <Metric value={row.annotations} label="A" />
          <ActionRail row={row} variantProps={props} tone="ledger" />
        </article>
      ))}
    </div>
  )
}

function VariantShelf(props: VariantProps) {
  return (
    <div className={styles.shelf} role="list" aria-label="Saved stamp shelf prototype">
      {props.rows.map((row) => (
        <article
          key={row.id}
          className={`${styles.shelfRow} ${props.selectedId === row.id ? styles.selectedRow : ''}`}
          role="listitem"
          onClick={() => props.select(row, 'select')}
        >
          <div className={styles.shelfPreview}>
            <MiniPlan row={row} />
            <span className={styles.shelfCode}>{row.code}</span>
          </div>
          <div className={styles.shelfBody}>
            <EditableName row={row} variantProps={props} className={styles.prototypeName} />
            <ObjectTrail row={row} />
          </div>
          <ActionRail row={row} variantProps={props} tone="shelf" />
        </article>
      ))}
    </div>
  )
}

function EditableName({
  row,
  variantProps,
  className,
}: {
  readonly row: StampPrototypeRow
  readonly variantProps: VariantProps
  readonly className?: string
}) {
  if (variantProps.editingId === row.id) {
    return (
      <input
        className={styles.prototypeNameInput}
        value={variantProps.nameFor(row)}
        aria-label="Rename stamp"
        onClick={(event) => event.stopPropagation()}
        onInput={(event) => variantProps.setName(row, (event.currentTarget as HTMLInputElement).value)}
        onBlur={() => variantProps.setEditingId(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            variantProps.setEditingId(null)
            ;(event.currentTarget as HTMLInputElement).blur()
          }
        }}
      />
    )
  }

  return <span className={className}>{variantProps.nameFor(row)}</span>
}

function ActionRail({
  row,
  variantProps,
  tone,
}: {
  readonly row: StampPrototypeRow
  readonly variantProps: VariantProps
  readonly tone: 'rail' | 'ledger' | 'shelf'
}) {
  const confirming = variantProps.deleteId === row.id
  return (
    <div className={`${styles.actionRail} ${styles[`actionRail${capitalize(tone)}`]}`}>
      <IconButton
        label="Place stamp"
        variant="primary"
        onClick={(event) => {
          event.stopPropagation()
          variantProps.select(row, 'place')
        }}
      >
        <PlaceIcon />
      </IconButton>
      <IconButton
        label="Rename stamp"
        onClick={(event) => {
          event.stopPropagation()
          variantProps.setEditingId(row.id)
          variantProps.select(row, 'edit')
        }}
      >
        <PencilIcon />
      </IconButton>
      <IconButton
        label="Export stamp"
        onClick={(event) => {
          event.stopPropagation()
          variantProps.select(row, 'export')
        }}
      >
        <ExportIcon />
      </IconButton>
      {confirming ? (
        <>
          <IconButton
            label="Confirm delete"
            variant="danger"
            onClick={(event) => {
              event.stopPropagation()
              variantProps.markDeleted(row)
            }}
          >
            <CheckIcon />
          </IconButton>
          <IconButton
            label="Cancel delete"
            onClick={(event) => {
              event.stopPropagation()
              variantProps.cancelDelete()
            }}
          >
            <CloseIcon />
          </IconButton>
        </>
      ) : (
        <IconButton
          label="Delete stamp"
          variant="dangerGhost"
          onClick={(event) => {
            event.stopPropagation()
            variantProps.confirmDelete(row)
          }}
        >
          <TrashIcon />
        </IconButton>
      )}
    </div>
  )
}

function IconButton({
  label,
  variant = 'ghost',
  onClick,
  children,
}: {
  readonly label: string
  readonly variant?: 'ghost' | 'primary' | 'danger' | 'dangerGhost'
  readonly onClick: (event: MouseEvent) => void
  readonly children: preact.ComponentChildren
}) {
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${styles[`iconButton${capitalize(variant)}`]}`}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PrototypeSwitcher({
  variant,
  setVariant,
}: {
  readonly variant: StampPrototypeVariant
  readonly setVariant: (variant: StampPrototypeVariant) => void
}) {
  return (
    <div className={styles.prototypeSwitcher} aria-label="Prototype variant switcher">
      <button type="button" className={styles.switcherButton} onClick={() => setVariant(previousVariant(variant))}>
        <ChevronLeftIcon />
      </button>
      <span className={styles.switcherLabel}>
        {variant} - {VARIANT_LABELS[variant]}
      </span>
      <button type="button" className={styles.switcherButton} onClick={() => setVariant(nextVariant(variant))}>
        <ChevronRightIcon />
      </button>
    </div>
  )
}

function MiniPlan({ row }: { readonly row: StampPrototypeRow }) {
  return (
    <svg className={styles.miniPlan} viewBox="0 0 44 34" aria-hidden="true">
      <rect className={styles.miniZone} x="6" y="7" width="30" height="16" transform="rotate(-8 21 15)" />
      <circle className={styles.miniPlantPrimary} cx="14" cy="14" r={row.density === 'large' ? '3.2' : '2.6'} />
      <circle className={styles.miniPlantSecondary} cx="23" cy="13" r="2.4" />
      <circle className={styles.miniPlantSecondary} cx="30" cy="18" r="2" />
      {row.annotations > 0 && <path className={styles.miniAnnotation} d="M12 27h18M12 30h11" />}
    </svg>
  )
}

function ObjectTrail({ row }: { readonly row: StampPrototypeRow }) {
  return (
    <span className={styles.objectTrail}>
      <span>{row.plants} plants</span>
      <span>{row.zones} zones</span>
      <span>{row.annotations} notes</span>
    </span>
  )
}

function Metric({ value, label }: { readonly value: number; readonly label: string }) {
  return (
    <span className={styles.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  )
}

function prototypeRowsFromStamps(stamps: readonly SavedObjectStamp[]): readonly StampPrototypeRow[] {
  if (stamps.length === 0) return SAMPLE_ROWS
  return stamps.map((stamp, index) => {
    const counts = countsFromPayload(stamp.payload_json)
    return {
      id: stamp.id,
      name: stamp.name,
      code: `ST-${String(index + 1).padStart(2, '0')}`,
      density: counts.plants > 20 ? 'large' : counts.plants > 8 ? 'medium' : 'small',
      ...counts,
    }
  })
}

function countsFromPayload(payloadJson: string): Pick<StampPrototypeRow, 'plants' | 'zones' | 'annotations'> {
  try {
    const payload = JSON.parse(payloadJson) as {
      plants?: unknown[]
      zones?: unknown[]
      annotations?: unknown[]
    }
    return {
      plants: payload.plants?.length ?? 0,
      zones: payload.zones?.length ?? 0,
      annotations: payload.annotations?.length ?? 0,
    }
  } catch {
    return { plants: 0, zones: 0, annotations: 0 }
  }
}

function summary(row: StampPrototypeRow): string {
  return `${row.plants + row.zones + row.annotations} objects`
}

function readVariant(): StampPrototypeVariant {
  if (typeof window === 'undefined') return 'A'
  const value = new URLSearchParams(window.location.search).get(PARAM)?.toUpperCase()
  return isVariant(value) ? value : 'A'
}

function writeVariant(variant: StampPrototypeVariant): void {
  const url = new URL(window.location.href)
  url.searchParams.set(PARAM, variant)
  window.history.replaceState(null, '', url)
}

function isVariant(value: string | null | undefined): value is StampPrototypeVariant {
  return VARIANTS.includes(value as StampPrototypeVariant)
}

function previousVariant(variant: StampPrototypeVariant): StampPrototypeVariant {
  const index = VARIANTS.indexOf(variant)
  return VARIANTS[(index + VARIANTS.length - 1) % VARIANTS.length]!
}

function nextVariant(variant: StampPrototypeVariant): StampPrototypeVariant {
  const index = VARIANTS.indexOf(variant)
  return VARIANTS[(index + 1) % VARIANTS.length]!
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5" cy="4" r="1" />
      <circle cx="11" cy="4" r="1" />
      <circle cx="5" cy="8" r="1" />
      <circle cx="11" cy="8" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="11" cy="12" r="1" />
    </svg>
  )
}

function PlaceIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v12" />
      <path d="M3 7.5h10" />
      <path d="M10 4.5 13 7.5 10 10.5" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 11.5 2.5 14 5 13.5 12.5 6 10.5 4z" />
      <path d="M9.5 5 11 3.5 12.5 5 11 6.5" />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v7" />
      <path d="M5.5 4.5 8 2 10.5 4.5" />
      <path d="M3 8v5h10V8" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 5h10" />
      <path d="M6 5V3h4v2" />
      <path d="M5 5 5.5 13h5L11 5" />
      <path d="M7 7v4" />
      <path d="M9 7v4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4 12 12" />
      <path d="M12 4 4 12" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3 5 8l5 5" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3 5 5-5 5" />
    </svg>
  )
}
