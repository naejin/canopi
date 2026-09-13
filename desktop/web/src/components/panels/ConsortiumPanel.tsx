import { useLayoutEffect, useRef } from 'preact/hooks'
import {
  supportedConsortiumStratum,
  useConsortiumDockWorkbench,
} from '../../app/consortium/dock-workbench'
import {
  CONSORTIUM_STRATA,
  CONSORTIUM_SUCCESSION_PHASES,
} from '../../app/consortium/time-model'
import type { ConsortiumListFilter } from '../../app/planning-view/state'
import type { ConsortiumPlanningRow } from '../../app/planning-projection'
import { t } from '../../i18n'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import { SpeciesIdentity } from '../shared/SpeciesIdentity'
import { SurfaceSearch } from '../shared/SurfaceSearch'
import { PlantSymbolGlyph } from '../canvas/PlantSymbolGlyph'
import { sidePanel } from '../../app/shell/state'
import styles from './ConsortiumPanel.module.css'

export function ConsortiumPanel() {
  const workbench = useConsortiumDockWorkbench()
  const scrollRef = useRef<HTMLDivElement>(null)
  const filterSummaryRef = useRef<HTMLButtonElement>(null)
  const cancelledEditorFocus = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = workbench.scrollTop
  }, [workbench.scrollTop])
  useLayoutEffect(() => {
    if (workbench.movedOutsideFilter) filterSummaryRef.current?.focus()
  }, [workbench.movedOutsideFilter])
  useLayoutEffect(() => {
    if (workbench.editor !== null || cancelledEditorFocus.current === null) return
    document.querySelector<HTMLButtonElement>(
      `button[data-consortium-edit="${encodeURIComponent(cancelledEditorFocus.current)}"]`,
    )?.focus()
    cancelledEditorFocus.current = null
  }, [workbench.editor])

  function cancelEditorAndRestoreFocus(): void {
    const canonicalName = workbench.editor?.canonicalName
    if (canonicalName) cancelledEditorFocus.current = canonicalName
    workbench.cancelEditor()
  }

  return (
    <section
      className={styles.panel}
      aria-label={t('canvas.consortium.title')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        if (workbench.editor) {
          cancelEditorAndRestoreFocus()
          return
        }
        sidePanel.value = null
        document.querySelector<HTMLButtonElement>('button[data-panel="consortium"]')?.focus()
      }}
    >
      <DockPanelHeader
        title={t('canvas.consortium.title')}
        count={workbench.projection.activeSpeciesCount}
      />
      {workbench.projection.activeSpeciesCount === 0 ? (
        <div className={styles.emptyState}>
          <strong>{t('canvas.consortium.noPlantsTitle')}</strong>
          <p>{t('canvas.consortium.empty')}</p>
        </div>
      ) : (
        <>
          <ConsortiumMatrix workbench={workbench} />
          <div className={styles.controls}>
            <SurfaceSearch
              value={workbench.search}
              onChange={workbench.setSearch}
              label={t('canvas.consortium.search')}
            />
            {workbench.filter && (
              <button
                ref={filterSummaryRef}
                type="button"
                className={styles.filterChip}
                onClick={() => {
                  workbench.setFilter(null)
                  workbench.dismissMovedConfirmation()
                }}
              >
                {filterLabel(workbench.filter)} <span aria-hidden="true">×</span>
              </button>
            )}
            {workbench.movedOutsideFilter && (
              <p className={styles.confirmation} role="status">
                {t('canvas.consortium.movedOutsideFilter')}
              </p>
            )}
          </div>
          {workbench.list.visibleCount === 0 ? (
            <div className={styles.emptyState}>
              <strong>{t('canvas.consortium.noResults')}</strong>
              <button type="button" onClick={() => {
                workbench.setSearch('')
                workbench.setFilter(null)
              }}>{t('canvas.consortium.clearFilters')}</button>
            </div>
          ) : (
            <div
              ref={scrollRef}
              className={styles.list}
              onScroll={(event) => workbench.setScrollTop(event.currentTarget.scrollTop)}
              onMouseLeave={workbench.clearHover}
            >
              {workbench.list.groups.map((group) => {
                const expanded = workbench.search.trim() !== ''
                  || workbench.filter?.stratum === group.stratum
                  || workbench.expandedStrata.has(group.stratum)
                return (
                  <section key={group.stratum} className={styles.group}>
                    <button
                      type="button"
                      className={styles.groupHeader}
                      aria-expanded={expanded}
                      onClick={() => workbench.toggleStratum(group.stratum)}
                    >
                      <span>{expanded ? '▾' : '▸'} {stratumLabel(group.stratum)}</span>
                      <small>{t('canvas.consortium.groupCounts', {
                        species: group.speciesCount,
                        plants: group.plantCount,
                      })}</small>
                    </button>
                    {expanded && group.rows.map((row) => (
                      workbench.editor?.canonicalName === row.canonicalName
                        ? <ConsortiumRowEditor key={row.canonicalName} row={row} workbench={workbench} onCancel={cancelEditorAndRestoreFocus} />
                        : <ConsortiumRow key={row.canonicalName} row={row} workbench={workbench} />
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

type Workbench = ReturnType<typeof useConsortiumDockWorkbench>

function ConsortiumMatrix({ workbench }: { workbench: Workbench }) {
  return (
    <div className={styles.matrixRegion}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th scope="col">{t('canvas.consortium.stratum')}</th>
            {CONSORTIUM_SUCCESSION_PHASES.map((phase) => (
              <th key={phase.key} scope="col" title={`${t(phase.labelKey)} · ${t(phase.durationKey)}`}>
                {phaseAbbreviation(phase.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workbench.projection.matrix.map((row) => (
            <tr key={row.stratum}>
              <th scope="row">
                <button
                  type="button"
                  aria-pressed={workbench.filter?.stratum === row.stratum && workbench.filter.phase === null}
                  onMouseEnter={() => workbench.hoverRows(workbench.projection.rows.filter((item) => item.stratum === row.stratum))}
                  onMouseLeave={workbench.clearHover}
                  onClick={() => workbench.setFilter(sameFilter(workbench.filter, row.stratum, null)
                    ? null
                    : { stratum: row.stratum, phase: null })}
                >{stratumLabel(row.stratum)}</button>
              </th>
              {row.counts.map((count, phase) => {
                const selected = sameFilter(workbench.filter, row.stratum, phase)
                const matchingRows = workbench.projection.rows.filter((item) => (
                  item.stratum === row.stratum && item.startPhase <= phase && item.endPhase >= phase
                ))
                return (
                  <td key={phase}>
                    <button
                      type="button"
                      aria-label={`${stratumLabel(row.stratum)} · ${t(CONSORTIUM_SUCCESSION_PHASES[phase]!.labelKey)} · ${count}`}
                      aria-pressed={selected}
                      onMouseEnter={() => workbench.hoverRows(matchingRows)}
                      onMouseLeave={workbench.clearHover}
                      onClick={() => workbench.setFilter(selected ? null : { stratum: row.stratum, phase })}
                    >{count}</button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.legend}>{t('canvas.consortium.matrixLegend')}</p>
    </div>
  )
}

function ConsortiumRow({ row, workbench }: { row: ConsortiumPlanningRow; workbench: Workbench }) {
  return (
    <article
      className={styles.row}
      onMouseEnter={() => workbench.hoverRow(row)}
      onMouseLeave={workbench.clearHover}
    >
      <button
        type="button"
        className={styles.identityButton}
        aria-pressed={workbench.focusedCanonical === row.canonicalName}
        onClick={() => workbench.toggleSpeciesFocus(row.canonicalName)}
      >
        <SpeciesIdentity
          commonName={row.commonName}
          canonicalName={row.canonicalName}
          mark={row.appearances.map((appearance) => (
            <span key={`${appearance.color}:${appearance.symbol}`} style={{ color: appearance.color }}>
              <PlantSymbolGlyph symbol={appearance.symbol} size={20} />
            </span>
          ))}
          detail={<>{row.code && <span className={styles.code}>{row.code} · </span>}{t('canvas.consortium.plantCount', { count: row.count })}</>}
        />
      </button>
      <button
        type="button"
        className={styles.editButton}
        data-consortium-edit={encodeURIComponent(row.canonicalName)}
        aria-label={t('canvas.consortium.editSpecies', { name: row.commonName })}
        onClick={() => workbench.openEditor(row)}
      >{t('canvas.consortium.edit')}</button>
      <PhaseIndicator row={row} />
    </article>
  )
}

function PhaseIndicator({ row }: { row: ConsortiumPlanningRow }) {
  return (
    <div className={styles.phaseLine}>
      <span className={styles.segments} aria-hidden="true">
        {CONSORTIUM_SUCCESSION_PHASES.map((phase, index) => (
          <span key={phase.key} data-active={row.startPhase <= index && row.endPhase >= index ? 'true' : undefined} />
        ))}
      </span>
      <span>{phaseSpanLabel(row.startPhase, row.endPhase)}</span>
    </div>
  )
}

function ConsortiumRowEditor({ row, workbench, onCancel }: { row: ConsortiumPlanningRow; workbench: Workbench; onCancel: () => void }) {
  const draft = workbench.editor!.draft
  const stratumItems: DropdownItem<string>[] = [
    ...(!supportedConsortiumStratum(draft.stratum)
      ? [{ value: draft.stratum, label: `${draft.stratum} · ${t('canvas.consortium.unsupported')}` }]
      : []),
    ...CONSORTIUM_STRATA.map((stratum) => ({ value: stratum, label: stratumLabel(stratum) })),
  ]
  const phaseItems: DropdownItem<number>[] = CONSORTIUM_SUCCESSION_PHASES.map((phase, index) => ({
    value: index,
    label: `${t(phase.labelKey)} · ${t(phase.durationKey)}`,
  }))
  return (
    <article className={`${styles.row} ${styles.rowEditor}`}>
      <SpeciesIdentity commonName={row.commonName} canonicalName={row.canonicalName} />
      <div className={styles.editorFields}>
        <div className={styles.editorField}>
          <span>{t('canvas.consortium.stratum')}</span>
          <Dropdown
            trigger={stratumItems.find((item) => item.value === draft.stratum)?.label}
            items={stratumItems}
            value={draft.stratum}
            onChange={(stratum) => workbench.updateDraft({ stratum })}
            ariaLabel={t('canvas.consortium.stratum')}
            floating
          />
        </div>
        <div className={styles.editorField}>
          <span>{t('canvas.consortium.firstPhase')}</span>
          <Dropdown
            trigger={phaseItems[draft.startPhase]?.label ?? String(draft.startPhase)}
            items={phaseItems}
            value={draft.startPhase}
            onChange={(startPhase) => workbench.updateDraft({ startPhase })}
            ariaLabel={t('canvas.consortium.firstPhase')}
            floating
          />
        </div>
        <div className={styles.editorField}>
          <span>{t('canvas.consortium.lastPhase')}</span>
          <Dropdown
            trigger={phaseItems[draft.endPhase]?.label ?? String(draft.endPhase)}
            items={phaseItems}
            value={draft.endPhase}
            onChange={(endPhase) => workbench.updateDraft({ endPhase })}
            ariaLabel={t('canvas.consortium.lastPhase')}
            floating
          />
        </div>
        {workbench.editorInvalid && (
          <p className={styles.validation} role="alert">{t('canvas.consortium.phaseError')}</p>
        )}
      </div>
      <div className={styles.editorActions}>
        <button type="button" onClick={onCancel}>{t('canvas.timeline.cancel')}</button>
        <button type="button" className={styles.primaryButton} onClick={workbench.saveEditor}>{t('canvas.timeline.save')}</button>
      </div>
    </article>
  )
}

function sameFilter(filter: ConsortiumListFilter | null, stratum: string, phase: number | null): boolean {
  return filter?.stratum === stratum && filter.phase === phase
}

function filterLabel(filter: ConsortiumListFilter): string {
  const stratum = stratumLabel(filter.stratum)
  return filter.phase === null
    ? stratum
    : `${stratum} · ${t(CONSORTIUM_SUCCESSION_PHASES[filter.phase]!.labelKey)}`
}

function stratumLabel(stratum: string): string {
  return supportedConsortiumStratum(stratum)
    ? t(`canvas.consortium.${stratum}`)
    : t('canvas.consortium.unsupportedStratum', { value: stratum })
}

function phaseAbbreviation(key: string): string {
  if (key === 'climax') return 'C'
  if (key.startsWith('placenta')) return `P${key.at(-1)}`
  return `S${key.at(-1)}`
}

function phaseSpanLabel(start: number, end: number): string {
  const first = CONSORTIUM_SUCCESSION_PHASES[start]
  const last = CONSORTIUM_SUCCESSION_PHASES[end]
  if (!first || !last) return `${start}–${end}`
  return start === end ? t(first.labelKey) : `${t(first.labelKey)} → ${t(last.labelKey)}`
}
