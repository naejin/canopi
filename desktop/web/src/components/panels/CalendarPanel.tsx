import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { useCalendarWorkbench, type CalendarTargetMode } from '../../app/timeline/calendar-workbench'
import {
  addCivilDays,
  addCivilMonths,
  civilDateToLocalDate,
  endOfCivilMonth,
  formatCivilDate,
  localToday,
  parseCivilDate,
  civilWeekStartsOnSunday,
  compareCivilDates,
  startOfCivilMonth,
  type CivilDate,
} from '../../app/timeline/civil-date'
import { ACTION_TYPES, type CalendarDayProjection, type CalendarPlanningAction, type CalendarTargetLabel } from '../../app/planning-projection'
import type { CalendarCompletionFilter, CalendarDisplay } from '../../app/planning-view/state'
import { sidePanel } from '../../app/shell/state'
import { t } from '../../i18n'
import { DockPanelHeader } from '../shared/DockPanelHeader'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import { SurfaceSearch } from '../shared/SurfaceSearch'
import { DatePicker } from '../shared/DatePicker'
import { normalizeSearchText } from '../../utils/normalize-search'
import styles from './CalendarPanel.module.css'

const FULL_MONTH_MIN_WIDTH = 640

export function CalendarPanel() {
  const workbench = useCalendarWorkbench()
  const panelRef = useRef<HTMLElement>(null)
  const agendaRef = useRef<HTMLDivElement>(null)
  const cancelledEditorFocus = useRef<string | null | undefined>(undefined)
  const [contentWidth, setContentWidth] = useState(0)
  const showFullMonth = workbench.expanded
    && contentWidth >= FULL_MONTH_MIN_WIDTH
    && workbench.display === 'month'

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measure = () => setContentWidth(panel.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!workbench.selectedDate || showFullMonth) return
    const row = agendaRef.current?.querySelector<HTMLElement>(
      `[data-agenda-date="${workbench.selectedDate}"]`,
    )
    row?.scrollIntoView({ block: 'start' })
  }, [showFullMonth, workbench.selectedDate])

  useLayoutEffect(() => {
    if (!showFullMonth && agendaRef.current) {
      agendaRef.current.scrollTop = workbench.scrollTop
    }
  }, [showFullMonth])
  useLayoutEffect(() => {
    if (workbench.editor !== null || cancelledEditorFocus.current === undefined) return
    const actionId = cancelledEditorFocus.current
    const selector = actionId
      ? `button[data-calendar-action="${encodeURIComponent(actionId)}"]`
      : 'button[data-calendar-add]'
    const trigger = panelRef.current?.querySelector<HTMLButtonElement>(selector)
      ?? panelRef.current?.querySelector<HTMLButtonElement>('button[data-calendar-add]')
    trigger?.focus()
    cancelledEditorFocus.current = undefined
  }, [workbench.editor])

  useEffect(() => () => workbench.setExpanded(false), [])

  function cancelEditorAndRestoreFocus(): void {
    cancelledEditorFocus.current = workbench.editor?.actionId ?? null
    workbench.cancelEditor()
  }

  function closePanel(): void {
    workbench.cancelEditor()
    workbench.setExpanded(false)
    sidePanel.value = null
    document.querySelector<HTMLButtonElement>('button[data-panel="calendar"]')?.focus()
  }

  function handleEscape(event: JSX.TargetedKeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (workbench.editor) {
      cancelEditorAndRestoreFocus()
      return
    }
    if (workbench.expanded) {
      workbench.setExpanded(false)
      panelRef.current?.querySelector<HTMLButtonElement>('[data-calendar-expand]')?.focus()
      return
    }
    closePanel()
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-label={t('canvas.calendar.title')}
      onKeyDown={handleEscape}
    >
      {workbench.editor ? (
        <CalendarEditor workbench={workbench} onCancel={cancelEditorAndRestoreFocus} />
      ) : (
        <>
          <DockPanelHeader
            title={t('canvas.calendar.title')}
            actions={(
              <button
                type="button"
                className={styles.headerAction}
                data-calendar-expand
                onClick={() => workbench.setExpanded(!workbench.expanded)}
              >
                {t(workbench.expanded ? 'canvas.calendar.reduce' : 'canvas.calendar.expand')}
              </button>
            )}
          />
          <CalendarToolbar workbench={workbench} wide={contentWidth >= FULL_MONTH_MIN_WIDTH} />
          {showFullMonth ? (
            <CalendarMonthGrid workbench={workbench} />
          ) : (
            <div
              ref={agendaRef}
              className={styles.scrollRegion}
              onScroll={(event) => workbench.setScrollTop(event.currentTarget.scrollTop)}
            >
              <MiniMonth workbench={workbench} />
              <CalendarAgenda workbench={workbench} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

type Workbench = ReturnType<typeof useCalendarWorkbench>

function CalendarToolbar({ workbench, wide }: { workbench: Workbench; wide: boolean }) {
  const actionTypeItems: DropdownItem<string>[] = [
    { value: 'all', label: t('canvas.calendar.allTypes') },
    ...ACTION_TYPES.map((type) => ({ value: type, label: actionTypeLabel(type) })),
  ]
  const completionItems: DropdownItem<CalendarCompletionFilter>[] = [
    { value: 'open', label: t('canvas.calendar.openActions') },
    { value: 'completed', label: t('canvas.calendar.completedActions') },
    { value: 'all', label: t('canvas.calendar.allActions') },
  ]
  const displayItems: DropdownItem<CalendarDisplay>[] = [
    { value: 'month', label: t('canvas.calendar.month') },
    { value: 'agenda', label: t('canvas.calendar.agenda') },
  ]
  const month = parseCivilDate(workbench.month) ?? localToday()
  const monthLabel = new Intl.DateTimeFormat(workbench.activeLocale, {
    month: 'long',
    year: 'numeric',
  }).format(civilDateToLocalDate(month))

  return (
    <div className={styles.toolbar}>
      <div className={styles.monthNavigation}>
        <button type="button" aria-label={t('canvas.calendar.previousMonth')} onClick={workbench.previousMonth}>‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" aria-label={t('canvas.calendar.nextMonth')} onClick={workbench.nextMonth}>›</button>
        <button type="button" className={styles.todayButton} onClick={workbench.showToday}>
          {t('canvas.calendar.today')}
        </button>
        {workbench.expanded && wide && (
          <Dropdown
            trigger={displayItems.find((item) => item.value === workbench.display)?.label}
            items={displayItems}
            value={workbench.display}
            onChange={workbench.setDisplay}
            ariaLabel={t('canvas.calendar.displayLabel')}
          />
        )}
      </div>
      <div className={styles.searchRow}>
        <button type="button" data-calendar-add className={styles.primaryButton} onClick={() => workbench.openAdd()}>
          {t('canvas.calendar.addAction')}
        </button>
        <SurfaceSearch
          value={workbench.search}
          onChange={workbench.setSearch}
          label={t('canvas.calendar.search')}
        />
      </div>
      <div className={styles.filterRow}>
        <Dropdown
          trigger={completionItems.find((item) => item.value === workbench.completion)?.label}
          items={completionItems}
          value={workbench.completion}
          onChange={workbench.setCompletion}
          ariaLabel={t('canvas.calendar.completionFilter')}
        />
        <Dropdown
          trigger={actionTypeItems.find((item) => item.value === workbench.actionType)?.label}
          items={actionTypeItems}
          value={workbench.actionType}
          onChange={workbench.setActionType}
          ariaLabel={t('canvas.calendar.typeFilter')}
        />
      </div>
    </div>
  )
}

function MiniMonth({ workbench }: { workbench: Workbench }) {
  return (
    <CalendarDateGrid
      workbench={workbench}
      compact
      onSelect={(day) => workbench.selectDate(day.dateKey)}
    />
  )
}

function CalendarMonthGrid({ workbench }: { workbench: Workbench }) {
  return (
    <div className={styles.monthGridRegion}>
      <CalendarDateGrid
        workbench={workbench}
        compact={false}
        onSelect={(day) => {
          workbench.selectDate(day.dateKey)
          if (day.actions.length === 0) workbench.openAdd(day.dateKey)
        }}
      />
      {workbench.projection.unscheduled.length > 0 && (
        <button
          type="button"
          className={styles.unscheduledBar}
          onClick={() => workbench.setDisplay('agenda')}
        >
          {t('canvas.calendar.unscheduledCount', { count: workbench.projection.unscheduled.length })}
        </button>
      )}
    </div>
  )
}

function CalendarDateGrid({ workbench, compact, onSelect }: {
  workbench: Workbench
  compact: boolean
  onSelect(day: CalendarDayProjection): void
}) {
  const todayKey = formatCivilDate(localToday())
  const visibleDays = workbench.projection.weeks.flat()
  const initialFocus = workbench.selectedDate
    && visibleDays.some((day) => day.dateKey === workbench.selectedDate)
    ? workbench.selectedDate
    : (visibleDays.some((day) => day.dateKey === todayKey)
      ? todayKey
      : formatCivilDate(workbench.projection.month))
  const [focusedDate, setFocusedDate] = useState(initialFocus)
  const rovingDate = visibleDays.some((day) => day.dateKey === focusedDate)
    ? focusedDate
    : initialFocus
  const focusRequest = useRef<string | null>(null)
  const gridRef = useRef<HTMLTableElement>(null)

  useLayoutEffect(() => {
    if (focusedDate !== rovingDate) setFocusedDate(rovingDate)
    const date = focusRequest.current
    if (!date) return
    focusRequest.current = null
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${date}"]`)?.focus()
  })

  const firstWeek = workbench.projection.weeks[0] ?? []
  const weekdays = firstWeek.map((day) => new Intl.DateTimeFormat(workbench.activeLocale, {
    weekday: compact ? 'narrow' : 'long',
  }).format(civilDateToLocalDate(day.date)))

  function moveFocus(date: CivilDate, days: number): void {
    const next = addCivilDays(date, days)
    const key = formatCivilDate(next)
    setFocusedDate(key)
    focusRequest.current = key
    if (next.month !== workbench.projection.month.month || next.year !== workbench.projection.month.year) {
      if (days < 0) workbench.previousMonth()
      else workbench.nextMonth()
    }
  }

  function handleDateKeyDown(event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, day: CalendarDayProjection): void {
    let amount: number | null = null
    if (event.key === 'ArrowLeft') amount = -1
    if (event.key === 'ArrowRight') amount = 1
    if (event.key === 'ArrowUp') amount = -7
    if (event.key === 'ArrowDown') amount = 7
    const weekday = civilDateToLocalDate(day.date).getDay()
    const weekOffset = civilWeekStartsOnSunday(workbench.activeLocale)
      ? weekday
      : (weekday + 6) % 7
    if (event.key === 'Home') amount = -weekOffset
    if (event.key === 'End') amount = 6 - weekOffset
    if (amount !== null) {
      event.preventDefault()
      moveFocus(day.date, amount)
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const next = addCivilMonths(day.date, event.key === 'PageUp' ? -1 : 1)
      const key = formatCivilDate(next)
      setFocusedDate(key)
      focusRequest.current = key
      if (event.key === 'PageUp') workbench.previousMonth()
      else workbench.nextMonth()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(day)
    }
  }

  return (
    <table ref={gridRef} className={compact ? styles.miniCalendar : styles.fullCalendar}>
      <thead>
        <tr>{weekdays.map((weekday, index) => <th key={index} scope="col">{weekday}</th>)}</tr>
      </thead>
      <tbody>
        {workbench.projection.weeks.map((week) => (
          <tr key={week[0]?.dateKey}>
            {week.map((day) => (
              <td key={day.dateKey} data-outside={day.inMonth ? undefined : 'true'}>
                <button
                  type="button"
                  className={styles.dateButton}
                  data-calendar-date={day.dateKey}
                  data-selected={workbench.selectedDate === day.dateKey ? 'true' : undefined}
                  data-today={todayKey === day.dateKey ? 'true' : undefined}
                  tabIndex={rovingDate === day.dateKey ? 0 : -1}
                  aria-label={new Intl.DateTimeFormat(workbench.activeLocale, { dateStyle: 'full' }).format(civilDateToLocalDate(day.date))}
                  onFocus={() => setFocusedDate(day.dateKey)}
                  onClick={() => onSelect(day)}
                  onKeyDown={(event) => handleDateKeyDown(event, day)}
                >
                  <span>{day.date.day}</span>
                  {compact && day.actions.length > 0 && <span className={styles.dots} aria-hidden="true">•</span>}
                </button>
                {!compact && (
                  <div className={styles.dayActions}>
                    {day.actions.slice(0, 3).map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className={styles.actionChip}
                        data-calendar-action={encodeURIComponent(action.id)}
                        data-action-type={knownActionType(action.actionType) ? action.actionType : 'other'}
                        onMouseEnter={() => workbench.hoverAction(action)}
                        onMouseLeave={workbench.clearHover}
                        onClick={(event) => {
                          event.stopPropagation()
                          workbench.openEdit(action.id)
                        }}
                      >
                        {actionDescription(action)}
                      </button>
                    ))}
                    {day.actions.length > 3 && (
                      <button type="button" className={styles.moreButton} onClick={() => {
                        workbench.selectDate(day.dateKey)
                        workbench.setDisplay('agenda')
                      }}>
                        {t('canvas.calendar.moreActions', { count: day.actions.length - 3 })}
                      </button>
                    )}
                  </div>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CalendarAgenda({ workbench }: { workbench: Workbench }) {
  const selectedDay = workbench.selectedDate
    ? workbench.projection.weeks.flat().find((day) => day.dateKey === workbench.selectedDate)
    : undefined
  const selectedActions = selectedDay?.actions ?? []
  const selectedActionSet = new Set(selectedActions)
  const remainingGroups = workbench.projection.agenda
    .map((group) => ({
      ...group,
      actions: group.actions.filter((action) => !selectedActionSet.has(action)),
    }))
    .filter((group) => group.actions.length > 0)
  return (
    <div className={styles.agenda}>
      {workbench.selectedDate && selectedActions.length === 0 && (
        <section className={styles.emptyDate} data-agenda-date={workbench.selectedDate}>
          <strong>{formatDisplayDate(workbench.selectedDate, workbench.activeLocale)}</strong>
          <span>{t('canvas.calendar.noActionsForDate')}</span>
          <button type="button" onClick={() => workbench.openAdd(workbench.selectedDate)}>
            {t('canvas.calendar.addForDate')}
          </button>
        </section>
      )}
      {workbench.selectedDate && selectedActions.length > 0 && (
        <CalendarAgendaGroup
          dateKey={workbench.selectedDate}
          actions={selectedActions}
          workbench={workbench}
          selected
        />
      )}
      {remainingGroups.map((group) => (
        <CalendarAgendaGroup
          key={group.dateKey}
          dateKey={group.dateKey}
          actions={group.actions}
          workbench={workbench}
        />
      ))}
      <section className={styles.agendaGroup}>
        <button
          type="button"
          className={styles.unscheduledHeader}
          aria-expanded={workbench.unscheduledExpanded}
          onClick={() => workbench.setUnscheduledExpanded(!workbench.unscheduledExpanded)}
        >
          <span>{workbench.unscheduledExpanded ? '▾' : '▸'} {t('canvas.calendar.unscheduled')}</span>
          <small>{workbench.projection.unscheduled.length}</small>
        </button>
        {workbench.unscheduledExpanded && workbench.projection.unscheduled.map((action) => (
          <CalendarActionRow key={action.id} action={action} workbench={workbench} />
        ))}
        {workbench.unscheduledExpanded && workbench.projection.unscheduled.length === 0 && (
          <p className={styles.quiet}>{t('canvas.calendar.noUnscheduled')}</p>
        )}
      </section>
      {workbench.projection.filteredCount === 0 && (
        <div className={styles.noResults}>
          <p>{t('canvas.calendar.noResults')}</p>
          <button type="button" onClick={() => {
            workbench.setSearch('')
            workbench.setActionType('all')
            workbench.setCompletion('open')
          }}>{t('canvas.calendar.clearFilters')}</button>
        </div>
      )}
    </div>
  )
}

function CalendarAgendaGroup({ dateKey, actions, workbench, selected = false }: {
  dateKey: string
  actions: readonly CalendarPlanningAction[]
  workbench: Workbench
  selected?: boolean
}) {
  return (
    <section
      className={styles.agendaGroup}
      data-agenda-date={dateKey}
      data-selected-date={selected ? 'true' : undefined}
    >
      <h3>
        <span>{formatDisplayDate(dateKey, workbench.activeLocale)}</span>
        <small>{t('canvas.calendar.actionCount', { count: actions.length })}</small>
      </h3>
      {actions.map((action) => (
        <CalendarActionRow key={action.id} action={action} workbench={workbench} />
      ))}
    </section>
  )
}

function CalendarActionRow({ action, workbench }: { action: CalendarPlanningAction; workbench: Workbench }) {
  return (
    <div
      className={styles.actionRow}
      data-calendar-agenda-action={encodeURIComponent(action.id)}
      onMouseEnter={() => workbench.hoverAction(action)}
      onMouseLeave={workbench.clearHover}
    >
      <input
        type="checkbox"
        checked={action.completed}
        aria-label={t('canvas.calendar.markCompleted', { action: actionDescription(action) })}
        onChange={(event) => workbench.toggleCompleted(action.id, event.currentTarget.checked)}
      />
      <button type="button" className={styles.actionBody} onClick={() => workbench.openEdit(action.id)}>
        <strong>{actionDescription(action)}</strong>
        <span>{actionTypeLabel(action.actionType)} · {targetSummary(action)}</span>
        <span>{actionDateSummary(action, workbench.activeLocale, workbench.projection.month)}</span>
      </button>
      <button
        type="button"
        className={styles.editChevron}
        data-calendar-action={encodeURIComponent(action.id)}
        aria-label={t('canvas.calendar.editAction', { action: actionDescription(action) })}
        onClick={() => workbench.openEdit(action.id)}
      >›</button>
    </div>
  )
}

function CalendarEditor({ workbench, onCancel }: { workbench: Workbench; onCancel: () => void }) {
  const editor = workbench.editor!
  const draft = editor.draft
  const action = editor.actionId
    ? workbench.projection.weeks.flat().flatMap((day) => day.actions).find((candidate) => candidate.id === editor.actionId)
      ?? workbench.projection.unscheduled.find((candidate) => candidate.id === editor.actionId)
    : null
  const speciesSearchRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [speciesSearch, setSpeciesSearch] = useState('')
  const speciesNeedle = normalizeSearchText(speciesSearch)
  const selectedSpecies = new Set(
    draft.targets.filter((target) => target.kind === 'species').map((target) => target.canonical_name),
  )
  const visibleSpecies = workbench.speciesList.filter((species) =>
    speciesNeedle !== ''
    && !selectedSpecies.has(species.canonical_name)
    && normalizeSearchText(`${species.display_name} ${species.canonical_name}`).includes(speciesNeedle),
  )
  const typeItems: DropdownItem<string>[] = [
    ...(knownActionType(draft.action_type)
      ? []
      : [{ value: draft.action_type, label: draft.action_type }]),
    ...ACTION_TYPES.map((type) => ({ value: type, label: actionTypeLabel(type) })),
  ]
  const selectedSpeciesTargets = draft.targets.filter((target) => target.kind === 'species')
  const selectedZone = draft.targets.find((target) => target.kind === 'zone')?.zone_name ?? ''
  const scheduleMode = !draft.scheduled ? 'unscheduled' : draft.range ? 'range' : 'single'
  const targetModeItems: DropdownItem<CalendarTargetMode>[] = (
    ['design', 'species', 'selection', 'zone'] as const
  ).map((mode) => ({
    value: mode,
    label: targetModeLabel(mode, workbench.selectedPlantCount),
    disabled: mode === 'selection' && workbench.selectedPlantCount === 0,
  }))
  const zoneItems: DropdownItem<string>[] = [
    { value: '', label: t('canvas.calendar.chooseZone') },
    ...(!workbench.zoneNames.includes(selectedZone) && selectedZone
      ? [{ value: selectedZone, label: `${selectedZone} · ${t('canvas.calendar.unavailable')}` }]
      : []),
    ...workbench.zoneNames.map((zone) => ({ value: zone, label: zone })),
  ]

  useLayoutEffect(() => {
    descriptionRef.current?.focus()
  }, [])

  function setScheduleMode(mode: 'range' | 'single' | 'unscheduled'): void {
    if (mode === 'unscheduled') {
      workbench.setScheduled(false)
      return
    }
    workbench.setRange(mode === 'range')
  }

  function selectedSpeciesLabel(canonicalName: string): { label: string; unavailable: boolean } {
    const option = workbench.speciesList.find((species) => species.canonical_name === canonicalName)
    const saved = action?.targetLabels.find((target) =>
      target.kind === 'species'
      && target.target.kind === 'species'
      && target.target.canonical_name === canonicalName,
    )
    return {
      label: option?.display_name ?? saved?.label ?? canonicalName,
      unavailable: option === undefined,
    }
  }

  return (
    <div className={styles.editor} role="dialog" aria-label={t(editor.mode === 'add' ? 'canvas.timeline.addTitle' : 'canvas.timeline.editTitle')}>
      <header className={styles.editorTitle}>
        <button type="button" className={styles.backButton} onClick={onCancel}>‹ {t('canvas.calendar.back')}</button>
        <h2>{t(editor.mode === 'add' ? 'canvas.timeline.addTitle' : 'canvas.timeline.editTitle')}</h2>
      </header>
      <div className={styles.editorFields}>
        <label>
          <span>{t('canvas.timeline.description')}</span>
          <textarea
            ref={descriptionRef}
            rows={1}
            className={styles.descriptionInput}
            data-calendar-description
            value={draft.description}
            onInput={(event) => workbench.updateDraft({ description: event.currentTarget.value })}
          />
        </label>
        <div className={styles.field}>
          <span>{t('canvas.timeline.actionType')}</span>
          <Dropdown
            className={styles.editorDropdown}
            trigger={typeItems.find((item) => item.value === draft.action_type)?.label}
            items={typeItems}
            value={draft.action_type}
            onChange={(value) => workbench.updateDraft({ action_type: value })}
            ariaLabel={t('canvas.timeline.actionType')}
            floating
          />
        </div>
        <section className={styles.scheduleEditor} aria-label={t('canvas.calendar.schedule')}>
          <div className={styles.scheduleModes} role="group" aria-label={t('canvas.calendar.schedule')}>
            {(['range', 'single', 'unscheduled'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={scheduleMode === mode}
                onClick={() => setScheduleMode(mode)}
              >
                {t(mode === 'range'
                  ? 'canvas.calendar.range'
                  : mode === 'single'
                    ? 'canvas.calendar.oneDay'
                    : 'canvas.calendar.unscheduled')}
              </button>
            ))}
          </div>
          {draft.scheduled && (
            <div className={styles.dateFields} data-calendar-date-fields data-range={draft.range ? 'true' : undefined}>
              <div className={styles.field}>
                <span>{t('canvas.timeline.startDate')}</span>
                <DatePicker
                  value={draft.start_date}
                  onChange={(value) => workbench.updateDraft({ start_date: value })}
                  ariaLabel={t('canvas.timeline.startDate')}
                  error={workbench.editorError === 'date-order'}
                  floating
                />
                {draft.start_date && !parseCivilDate(draft.start_date) && (
                  <span className={styles.validation}>{t('canvas.calendar.savedInvalidDate', { value: draft.start_date })}</span>
                )}
              </div>
              {draft.range && (
                <div className={styles.field}>
                  <span>{t('canvas.calendar.endInclusive')}</span>
                  <DatePicker
                    value={draft.end_date}
                    onChange={(value) => workbench.updateDraft({ end_date: value })}
                    ariaLabel={t('canvas.calendar.endInclusive')}
                    error={workbench.editorError === 'date-order'}
                    floating
                  />
                  {draft.end_date && !parseCivilDate(draft.end_date) && (
                    <span className={styles.validation}>{t('canvas.calendar.savedInvalidDate', { value: draft.end_date })}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {workbench.editorError === 'date-order' && (
            <p className={styles.validation} role="alert">{t('canvas.timeline.dateError')}</p>
          )}
        </section>
        <section className={styles.targetEditor} aria-label={t('canvas.calendar.targets')}>
          <span className={styles.fieldLabel}>{t('canvas.calendar.targets')}</span>
          <Dropdown
            className={styles.editorDropdown}
            trigger={targetModeLabel(draft.targetMode, workbench.selectedPlantCount, draft.targets.length)}
            items={targetModeItems}
            value={draft.targetMode}
            onChange={(mode) => workbench.setTargetMode(mode as Exclude<CalendarTargetMode, 'preserve'>)}
            ariaLabel={t('canvas.calendar.targets')}
            floating
          />
          {draft.targetMode === 'preserve' && (
            <p className={styles.savedTargets}>{t('canvas.calendar.mixedTargetsPreserved', { count: draft.targets.length })}</p>
          )}
          {action && !draft.targetsChanged && (
            draft.targetMode === 'preserve'
            || (draft.targetMode !== 'species' && action.targetLabels.some((target) => target.unavailable))
          ) && (
            <ul className={styles.savedTargetList}>
              {action.targetLabels.map((target, index) => (
                <li key={`${target.kind}:${target.label}:${index}`}>{calendarTargetLabel(target)}</li>
              ))}
            </ul>
          )}
          {draft.targetMode === 'species' && (
            <div className={styles.targetPicker}>
              {selectedSpeciesTargets.length > 0 && (
                <div className={styles.selectedSpecies} aria-label={t('canvas.calendar.speciesTargets')}>
                  {selectedSpeciesTargets.map((target) => {
                    const selected = selectedSpeciesLabel(target.canonical_name)
                    return (
                      <button
                        key={target.canonical_name}
                        type="button"
                        className={styles.speciesChip}
                        data-calendar-selected-target={target.canonical_name}
                        aria-label={t('canvas.calendar.removeSpecies', { name: selected.label })}
                        onClick={() => workbench.toggleSpeciesTarget(target.canonical_name)}
                      >
                        <span>{selected.label}</span>
                        {selected.unavailable && <small>{t('canvas.calendar.unavailable')}</small>}
                        <span aria-hidden="true">×</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <input
                ref={speciesSearchRef}
                type="search"
                value={speciesSearch}
                placeholder={t('canvas.calendar.searchSpecies')}
                aria-label={t('canvas.calendar.searchSpecies')}
                onInput={(event) => setSpeciesSearch(event.currentTarget.value)}
              />
              {speciesNeedle !== '' && <div className={styles.speciesOptions}>
                {visibleSpecies.map((species) => (
                  <button
                    key={species.canonical_name}
                    type="button"
                    className={styles.speciesOption}
                    data-calendar-species-option={species.canonical_name}
                    onClick={() => {
                      workbench.toggleSpeciesTarget(species.canonical_name)
                      setSpeciesSearch('')
                      speciesSearchRef.current?.focus()
                    }}
                  >
                    <span>{species.display_name}</span>
                    <em>{species.canonical_name}</em>
                  </button>
                ))}
                {visibleSpecies.length === 0 && (
                  <p className={styles.quiet}>{t('canvas.calendar.noSpeciesMatches')}</p>
                )}
              </div>}
            </div>
          )}
          {draft.targetMode === 'selection' && (
            <p className={styles.savedTargets}>{t('canvas.calendar.plantSelectionCount', { count: draft.targets.length })}</p>
          )}
          {draft.targetMode === 'zone' && (
            <Dropdown
              trigger={zoneItems.find((item) => item.value === selectedZone)?.label}
              items={zoneItems}
              value={selectedZone}
              onChange={workbench.setZoneTarget}
              ariaLabel={t('canvas.calendar.zone')}
              floating
            />
          )}
          {workbench.editorError === 'empty-targets' && (
            <p className={styles.validation} role="alert">{t('canvas.calendar.targetRequired')}</p>
          )}
        </section>
        <label className={styles.checkboxLabel} data-calendar-completed>
          <input
            type="checkbox"
            checked={draft.completed}
            onChange={(event) => workbench.updateDraft({ completed: event.currentTarget.checked })}
          />
          <span>{t('canvas.calendar.completed')}</span>
        </label>
        {action?.recurrence && (
          <p className={styles.savedTargets}>
            {t('canvas.calendar.savedRecurrence', { value: action.recurrence })}
          </p>
        )}
      </div>
      <div className={styles.editorActions}>
        {editor.mode === 'edit' && (
          <button type="button" className={styles.deleteButton} onClick={workbench.deleteEditorAction}>
            {t('canvas.timeline.delete')}
          </button>
        )}
        <button type="button" onClick={onCancel}>{t('canvas.timeline.cancel')}</button>
        <button type="button" className={styles.primaryButton} onClick={workbench.saveEditor}>
          {t('canvas.timeline.save')}
        </button>
      </div>
    </div>
  )
}

function actionDescription(action: CalendarPlanningAction): string {
  return action.description.trim() || actionTypeLabel(action.actionType)
}

function actionTypeLabel(actionType: string): string {
  return knownActionType(actionType) ? t(`canvas.timeline.type_${actionType}`) : actionType
}

function knownActionType(actionType: string): boolean {
  return ACTION_TYPES.includes(actionType as (typeof ACTION_TYPES)[number])
}

function targetSummary(action: CalendarPlanningAction): string {
  if (action.targetLabels.length === 0) return t('canvas.calendar.noTarget')
  return action.targetLabels.map(calendarTargetLabel).join(', ')
}

function calendarTargetLabel(target: CalendarTargetLabel): string {
  const label = target.kind === 'manual'
    ? t('canvas.calendar.wholeDesign')
    : target.kind === 'none'
      ? t('canvas.calendar.noTarget')
      : target.label
  return target.unavailable ? `${label} · ${t('canvas.calendar.unavailable')}` : label
}

function actionDateSummary(action: CalendarPlanningAction, locale: string, month: CivilDate): string {
  if (!action.parsedStart) {
    if (action.endDate) return t('canvas.calendar.unscheduledWithEnd', { value: action.endDate })
    if (action.startDate) return t('canvas.calendar.invalidStart', { value: action.startDate })
    return t('canvas.calendar.unscheduled')
  }
  const start = formatDisplayDate(formatCivilDate(action.parsedStart), locale)
  if (!action.endDate) return start
  if (!action.parsedEnd || action.invalidRange) {
    return t('canvas.calendar.savedDateRange', { start: action.startDate, end: action.endDate })
  }
  const continuation = [
    compareCivilDates(action.parsedStart, startOfCivilMonth(month)) < 0
      ? t('canvas.calendar.continuesBefore')
      : null,
    compareCivilDates(action.parsedEnd, endOfCivilMonth(month)) > 0
      ? t('canvas.calendar.continuesAfter')
      : null,
  ].filter((value): value is string => value !== null)
  const range = `${start} – ${formatDisplayDate(formatCivilDate(action.parsedEnd), locale)}`
  return continuation.length > 0 ? `${range} · ${continuation.join(' · ')}` : range
}

function formatDisplayDate(value: string, locale: string): string {
  const date = parseCivilDate(value)
  return date
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(civilDateToLocalDate(date))
    : value
}

function targetModeLabel(mode: CalendarTargetMode, selectedCount: number, targetCount?: number): string {
  if (mode === 'preserve') return t('canvas.calendar.mixedTargetsPreserved', { count: targetCount })
  if (mode === 'design') return t('canvas.calendar.wholeDesign')
  if (mode === 'species') return t('canvas.calendar.speciesTargets')
  if (mode === 'selection') return t('canvas.calendar.currentSelection', { count: targetCount ?? selectedCount })
  return t('canvas.calendar.zone')
}
