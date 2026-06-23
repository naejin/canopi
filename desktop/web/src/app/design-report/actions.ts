import { getCurrentCanvasDocumentSurface, getCurrentCanvasQuerySurface } from '../../canvas/session'
import type { CanvasDocumentSurface, CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { getLegendEntries } from '../../canvas/display-modes'
import { actionColor } from '../../canvas/timeline-renderer'
import { buildPinnedPlantNameLegendEntries } from '../../canvas/pinned-plant-name-legend'
import { hydrateScenePersistedState } from '../../canvas/runtime/scene/codec'
import type { ScenePersistedState, SceneViewportState } from '../../canvas/runtime/scene'
import type { SceneRendererSnapshot } from '../../canvas/runtime/renderers/scene-types'
import { renderCanvas2DSceneSnapshot } from '../../canvas/runtime/renderers/canvas2d-scene'
import { computePinnedPlantNameLabels } from '../../canvas/runtime/selection-labels'
import { formatMetricDistance } from '../../canvas/runtime/zone-measurements'
import { ACTION_TYPES } from '../planning-projection/timeline'
import { buildConsortiumPlanningProjection, type ConsortiumPlanningBar } from '../planning-projection/consortium'
import {
  CONSORTIUM_STRATA,
  CONSORTIUM_SUCCESSION_PHASES,
  DEFAULT_CONSORTIUM_END_PHASE,
  DEFAULT_CONSORTIUM_START_PHASE,
  DEFAULT_CONSORTIUM_STRATUM,
  clampSuccessionPhaseIndex,
  stratumToRow,
} from '../consortium/time-model'
import { locale } from '../settings/state'
import { formatBudgetCurrency } from '../budget/formatting'
import { buildPersistedDesignSessionContent } from '../document-session/persistence'
import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import type { Annotation, BudgetItem, CanopiFile, Consortium, Location, MeasurementGuide, PanelTarget, PlacedPlant, TimelineAction, Zone } from '../../types/design'
import { exportDesignReportPdf } from '../../ipc/design-report'
import { t } from '../../i18n'
import { DEFAULT_BUDGET_CURRENCY } from '../../generated/known-canopi-keys'

export type DesignReportPageOrientation = 'portrait' | 'landscape'

export interface DesignReportBounds {
  readonly min_x: number
  readonly min_y: number
  readonly max_x: number
  readonly max_y: number
}

export interface DesignReportCanvasPageInput {
  readonly orientation: DesignReportPageOrientation
  readonly width_mm: number
  readonly height_mm: number
  readonly margin_mm: number
  readonly background: '#FFFFFF'
}

export interface DesignReportMetadataInput {
  readonly description?: string
  readonly location?: Location
}

export interface DesignReportLabelsInput {
  readonly overview: string
  readonly location: string
  readonly altitude: string
  readonly design: string
  readonly visible_layers: string
  readonly default_visible_layers: string
  readonly no_visible_canvas_objects: string
  readonly pinned: string
  readonly color_by: string
  readonly page_number: string
}

export interface DesignReportPlantInput {
  readonly id: string
  readonly canonical_name: string
  readonly common_name: string | null
  readonly color: string | null
  readonly symbol: string | null
  readonly pinned_name_label: string | null
  readonly radius_m: number | null
  readonly x: number
  readonly y: number
}

export interface DesignReportZoneInput {
  readonly name: string
  readonly zone_type: string
  readonly fill_color: string | null
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

export interface DesignReportAnnotationInput {
  readonly id: string
  readonly text: string
  readonly x: number
  readonly y: number
}

export interface DesignReportMeasurementGuideInput {
  readonly id: string
  readonly start: { readonly x: number; readonly y: number }
  readonly end: { readonly x: number; readonly y: number }
  readonly label: string
}

export interface DesignReportCanvasImageInput {
  readonly data_base64: string
  readonly width_px: number
  readonly height_px: number
}

export interface DesignReportPinnedPlantNameLegendInput {
  readonly kind: 'pinned-plant-names'
  readonly title: string
  readonly entries: readonly {
    readonly label: string
    readonly color: string
    readonly symbol: string
    readonly count: number
  }[]
}

export interface DesignReportColorByLegendInput {
  readonly kind: 'color-by'
  readonly title: string
  readonly attribute: string
  readonly entries: readonly {
    readonly label: string
    readonly color: string
  }[]
}

export type DesignReportCanvasLegendInput =
  | DesignReportPinnedPlantNameLegendInput
  | DesignReportColorByLegendInput

export interface DesignReportCanvasInput {
  readonly page: DesignReportCanvasPageInput
  readonly bounds: DesignReportBounds | null
  readonly visible_layer_names: readonly string[]
  readonly plants: readonly DesignReportPlantInput[]
  readonly zones: readonly DesignReportZoneInput[]
  readonly annotations: readonly DesignReportAnnotationInput[]
  readonly measurement_guides: readonly DesignReportMeasurementGuideInput[]
  readonly image: DesignReportCanvasImageInput | null
  readonly legend: DesignReportCanvasLegendInput | null
}

export interface DesignReportInput {
  readonly title: string
  readonly labels: DesignReportLabelsInput
  readonly metadata: DesignReportMetadataInput
  readonly canvas: DesignReportCanvasInput
  readonly timeline: DesignReportTimelineInput | null
  readonly budget: DesignReportBudgetInput | null
  readonly consortium: DesignReportConsortiumInput | null
}

export interface DesignReportTimelineColumnsInput {
  readonly action_type: string
  readonly description: string
  readonly start_date: string
  readonly end_date: string
  readonly recurrence: string
  readonly target: string
  readonly dependencies: string
  readonly status: string
}

export interface DesignReportTimelineOverviewRowInput {
  readonly action_type: string
  readonly label: string
  readonly color: string
  readonly count: number
  readonly date_range: string
}

export interface DesignReportTimelineActionInput {
  readonly id: string
  readonly action_type: string
  readonly action_type_label: string
  readonly description: string
  readonly start_date: string
  readonly end_date: string
  readonly recurrence: string
  readonly target: string
  readonly dependencies: string
  readonly status: string
}

export interface DesignReportTimelineInput {
  readonly title: string
  readonly overview_title: string
  readonly table_title: string
  readonly columns: DesignReportTimelineColumnsInput
  readonly overview_rows: readonly DesignReportTimelineOverviewRowInput[]
  readonly actions: readonly DesignReportTimelineActionInput[]
}

export interface DesignReportBudgetColumnsInput {
  readonly target: string
  readonly category: string
  readonly description: string
  readonly quantity: string
  readonly unit_cost: string
  readonly line_total: string
  readonly currency: string
}

export interface DesignReportBudgetRowInput {
  readonly target: string
  readonly category: string
  readonly description: string
  readonly quantity: string
  readonly unit_cost: string
  readonly line_total: string
  readonly currency: string
}

export interface DesignReportBudgetTotalInput {
  readonly label: string
  readonly currency: string
  readonly amount: string
}

export interface DesignReportBudgetInput {
  readonly title: string
  readonly columns: DesignReportBudgetColumnsInput
  readonly rows: readonly DesignReportBudgetRowInput[]
  readonly totals: readonly DesignReportBudgetTotalInput[]
}

export interface DesignReportConsortiumColumnsInput {
  readonly plant: string
  readonly canonical_name: string
  readonly stratum: string
  readonly start_phase: string
  readonly end_phase: string
  readonly count: string
}

export interface DesignReportConsortiumChartEntryInput {
  readonly label: string
  readonly color: string
}

export interface DesignReportConsortiumChartCellInput {
  readonly entries: readonly DesignReportConsortiumChartEntryInput[]
}

export interface DesignReportConsortiumChartRowInput {
  readonly stratum: string
  readonly cells: readonly DesignReportConsortiumChartCellInput[]
}

export interface DesignReportConsortiumRowInput {
  readonly plant: string
  readonly canonical_name: string | null
  readonly stratum: string
  readonly start_phase: string
  readonly end_phase: string
  readonly count: string
}

export interface DesignReportConsortiumInput {
  readonly title: string
  readonly chart_title: string
  readonly table_title: string
  readonly phases: readonly string[]
  readonly columns: DesignReportConsortiumColumnsInput
  readonly chart_rows: readonly DesignReportConsortiumChartRowInput[]
  readonly rows: readonly DesignReportConsortiumRowInput[]
}

interface BudgetReportRowComputation {
  readonly input: DesignReportBudgetRowInput
  readonly currency: string
  readonly lineTotal: number
}

interface CurrentDesignReportOptions {
  readonly session?: CanvasDocumentSurface | null
  readonly querySurface?: CanvasQuerySurface | null
  readonly store?: DesignSessionStore
  readonly canvasImageRenderer?: DesignReportCanvasImageRenderer | null
}

interface DesignReportInputOptions {
  readonly querySurface?: CanvasQuerySurface | null
  readonly canvasImageRenderer?: DesignReportCanvasImageRenderer | null
}

export interface DesignReportCanvasImageRenderRequest {
  readonly scene: ScenePersistedState
  readonly bounds: DesignReportBounds
  readonly page: DesignReportCanvasPageInput
  readonly background: '#FFFFFF'
  readonly localizedNames: ReadonlyMap<string, string | null>
  readonly sizeMode: ReturnType<CanvasQuerySurface['getPlantSizeMode']>
  readonly colorByAttr: ReturnType<CanvasQuerySurface['getPlantColorByAttr']>
}

export type DesignReportCanvasImageRenderer = (
  request: DesignReportCanvasImageRenderRequest,
) => DesignReportCanvasImageInput | null

const A4_PORTRAIT = { width_mm: 210, height_mm: 297 } as const
const REPORT_MARGIN_MM = 14
const REPORT_CANVAS_IMAGE_PX_PER_MM = 5

export function buildDesignReportInput(
  file: CanopiFile,
  options: DesignReportInputOptions = {},
): DesignReportInput {
  const canvas = buildCanvasInput(
    file,
    options.querySurface ?? null,
    options.canvasImageRenderer === undefined
      ? renderDesignReportCanvasImage
      : options.canvasImageRenderer,
  )
  const timeline = buildTimelineInput(file, options.querySurface ?? null)
  const budget = buildBudgetInput(file, options.querySurface ?? null)
  const consortium = buildConsortiumInput(file, options.querySurface ?? null)
  const description = nonEmptyString(file.description)

  return {
    title: nonEmptyString(file.name) ?? 'Untitled Design',
    labels: buildReportLabels(),
    metadata: {
      ...(description ? { description } : {}),
      ...(file.location ? { location: file.location } : {}),
    },
    canvas,
    timeline,
    budget,
    consortium,
  }
}

function buildReportLabels(): DesignReportLabelsInput {
  return {
    overview: t('designReport.document.overview'),
    location: t('designReport.document.location'),
    altitude: t('designReport.document.altitude'),
    design: t('designReport.document.design'),
    visible_layers: t('designReport.document.visibleLayers'),
    default_visible_layers: t('designReport.document.defaultVisibleLayers'),
    no_visible_canvas_objects: t('designReport.document.noVisibleCanvasObjects'),
    pinned: t('designReport.document.pinned'),
    color_by: t('designReport.document.colorBy'),
    page_number: t('designReport.document.pageNumber'),
  }
}

export function buildCurrentDesignReportInput({
  session = getCurrentCanvasDocumentSurface(),
  querySurface = getCurrentCanvasQuerySurface(),
  store = designSessionStore,
  canvasImageRenderer,
}: CurrentDesignReportOptions = {}): DesignReportInput | null {
  if (!store.hasCurrentDesign()) return null

  const file = buildPersistedDesignSessionContent({
    session,
    name: store.readDesignName(),
    store,
  })
  return buildDesignReportInput(file, { querySurface, canvasImageRenderer })
}

export async function exportCurrentDesignReportPdf(
  options: CurrentDesignReportOptions = {},
): Promise<string | null> {
  const input = buildCurrentDesignReportInput(options)
  if (!input) return null
  return exportDesignReportPdf(input, defaultReportFileName(input.title))
}

function buildCanvasInput(
  file: CanopiFile,
  querySurface: CanvasQuerySurface | null,
  canvasImageRenderer: DesignReportCanvasImageRenderer | null,
): DesignReportCanvasInput {
  const localizedNames = querySurface?.getLocalizedCommonNames() ?? new Map<string, string | null>()
  const plants = isLayerVisible(file, 'plants')
    ? file.plants.map((plant) => reportPlant(plant, localizedNames))
    : []
  const zones = isLayerVisible(file, 'zones') ? file.zones.map(reportZone) : []
  const annotations = isLayerVisible(file, 'annotations') ? file.annotations.map(reportAnnotation) : []
  const measurementGuides = isLayerVisible(file, 'measurement-guides')
    ? (file.measurement_guides ?? []).map(reportMeasurementGuide)
    : []
  const bounds = computeReportBounds(plants, zones, annotations, measurementGuides)
  const orientation = choosePageOrientation(bounds)
  const page = {
    orientation,
    width_mm: orientation === 'landscape' ? A4_PORTRAIT.height_mm : A4_PORTRAIT.width_mm,
    height_mm: orientation === 'landscape' ? A4_PORTRAIT.width_mm : A4_PORTRAIT.height_mm,
    margin_mm: REPORT_MARGIN_MM,
    background: '#FFFFFF',
  } as const
  const scene = querySurface?.getSceneSnapshot() ?? hydrateScenePersistedState(file)
  const sizeMode = querySurface?.getPlantSizeMode() ?? 'default'
  const colorByAttr = querySurface?.getPlantColorByAttr() ?? null
  const image = bounds && canvasImageRenderer
    ? canvasImageRenderer({
      scene,
      bounds,
      page,
      background: '#FFFFFF',
      localizedNames,
      sizeMode,
      colorByAttr,
    })
    : null

  return {
    page,
    bounds,
    visible_layer_names: file.layers
      .filter((layer) => layer.visible)
      .map((layer) => reportLayerLabel(layer.name)),
    plants,
    zones,
    annotations,
    measurement_guides: measurementGuides,
    image,
    legend: buildCanvasLegend(file, querySurface),
  }
}

function reportPlant(
  plant: PlacedPlant,
  localizedNames: ReadonlyMap<string, string | null>,
): DesignReportPlantInput {
  const displayName = localizedPlantName(plant, localizedNames)
  return {
    id: plant.id,
    canonical_name: plant.canonical_name,
    common_name: displayName,
    color: plant.color ?? null,
    symbol: plant.symbol ?? null,
    pinned_name_label: plant.pinned_name === true ? displayName : null,
    radius_m: typeof plant.scale === 'number' && plant.scale > 0 ? plant.scale / 2 : null,
    x: plant.position.x,
    y: plant.position.y,
  }
}

function reportZone(zone: Zone): DesignReportZoneInput {
  return {
    name: zone.name,
    zone_type: zone.zone_type,
    fill_color: zone.fill_color ?? null,
    points: zone.points.map((point) => ({ x: point.x, y: point.y })),
  }
}

function reportAnnotation(annotation: Annotation): DesignReportAnnotationInput {
  return {
    id: annotation.id,
    text: annotation.text,
    x: annotation.position.x,
    y: annotation.position.y,
  }
}

function reportMeasurementGuide(
  guide: MeasurementGuide,
  index: number,
): DesignReportMeasurementGuideInput {
  const dx = guide.end.x - guide.start.x
  const dy = guide.end.y - guide.start.y
  return {
    id: guide.id || `measurement-guide-${index + 1}`,
    start: { x: guide.start.x, y: guide.start.y },
    end: { x: guide.end.x, y: guide.end.y },
    label: formatMetricDistance(Math.hypot(dx, dy)),
  }
}

function buildCanvasLegend(
  file: CanopiFile,
  querySurface: CanvasQuerySurface | null,
): DesignReportCanvasLegendInput | null {
  const colorByAttr = querySurface?.getPlantColorByAttr() ?? null
  if (colorByAttr !== null) {
    return {
      kind: 'color-by',
      title: t('canvas.display.legend'),
      attribute: plantColorByAttributeLabel(colorByAttr),
      entries: getLegendEntries(colorByAttr).map((entry) => ({
        label: entry.label,
        color: entry.color,
      })),
    }
  }

  const sizeMode = querySurface?.getPlantSizeMode() ?? 'default'
  if (sizeMode !== 'default') return null

  const localizedNames = querySurface?.getLocalizedCommonNames() ?? new Map<string, string | null>()
  const source = {
    getSceneSnapshot: () => hydrateScenePersistedState(file),
    getLocalizedCommonNames: () => localizedNames,
  }
  const entries = buildPinnedPlantNameLegendEntries(source)
  if (entries.length === 0) return null

  return {
    kind: 'pinned-plant-names',
    title: t('canvas.display.legend'),
    entries: entries.map((entry) => ({
      label: entry.label,
      color: entry.color,
      symbol: entry.symbol,
      count: entry.count,
    })),
  }
}

function buildTimelineInput(
  file: CanopiFile,
  querySurface: CanvasQuerySurface | null,
): DesignReportTimelineInput | null {
  if (file.timeline.length === 0) return null

  const activeLocale = locale.value
  const localizedNames = querySurface?.getLocalizedCommonNames() ?? new Map<string, string | null>()
  const sortedActions = [...file.timeline].sort(compareTimelineActions)

  return {
    title: t('canvas.timeline.title'),
    overview_title: t('designReport.timeline.overview'),
    table_title: t('designReport.timeline.actions'),
    columns: {
      action_type: t('canvas.timeline.actionType'),
      description: t('canvas.timeline.description'),
      start_date: t('canvas.timeline.startDate'),
      end_date: t('canvas.timeline.endDate'),
      recurrence: t('designReport.timeline.recurrence'),
      target: t('designReport.timeline.target'),
      dependencies: t('designReport.timeline.dependencies'),
      status: t('designReport.timeline.status'),
    },
    overview_rows: buildTimelineOverviewRows(file.timeline, activeLocale),
    actions: sortedActions.map((action) => reportTimelineAction(action, file, localizedNames, activeLocale)),
  }
}

function buildTimelineOverviewRows(
  actions: readonly TimelineAction[],
  activeLocale: string,
): DesignReportTimelineOverviewRowInput[] {
  const rows: DesignReportTimelineOverviewRowInput[] = []
  for (const actionType of ACTION_TYPES) {
    const matching = actions.filter((action) => normalizeTimelineActionType(action.action_type) === actionType)
    if (matching.length === 0) continue
    rows.push({
      action_type: actionType,
      label: timelineActionTypeLabel(actionType),
      color: actionColor(actionType),
      count: matching.length,
      date_range: timelineActionsDateRange(matching, activeLocale),
    })
  }
  return rows
}

function reportTimelineAction(
  action: TimelineAction,
  file: CanopiFile,
  localizedNames: ReadonlyMap<string, string | null>,
  activeLocale: string,
): DesignReportTimelineActionInput {
  return {
    id: action.id,
    action_type: action.action_type,
    action_type_label: timelineActionTypeLabel(action.action_type),
    description: nonEmptyString(action.description) ?? '',
    start_date: formatTimelineDateValue(action.start_date, activeLocale),
    end_date: formatTimelineDateValue(action.end_date, activeLocale),
    recurrence: nonEmptyString(action.recurrence) ?? t('designReport.timeline.none'),
    target: timelineTargetsLabel(action.targets, file, localizedNames),
    dependencies: timelineDependenciesLabel(action.depends_on),
    status: action.completed ? t('designReport.timeline.completed') : t('designReport.timeline.open'),
  }
}

function compareTimelineActions(left: TimelineAction, right: TimelineAction): number {
  return (
    left.order - right.order
    || compareNullableStrings(left.start_date, right.start_date)
    || left.description.localeCompare(right.description)
    || left.id.localeCompare(right.id)
  )
}

function compareNullableStrings(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left.localeCompare(right)
}

function normalizeTimelineActionType(actionType: string): string {
  return ACTION_TYPES.includes(actionType as never) ? actionType : 'other'
}

function timelineActionTypeLabel(actionType: string): string {
  return t(`canvas.timeline.type_${normalizeTimelineActionType(actionType)}`)
}

function timelineActionsDateRange(
  actions: readonly TimelineAction[],
  activeLocale: string,
): string {
  const unscheduledCount = actions.filter((action) => !timelineActionHasScheduledDate(action)).length
  const dates = actions
    .flatMap((action) => [action.start_date, action.end_date])
    .filter(isValidTimelineDate)
    .sort()
  if (dates.length === 0) return t('designReport.timeline.notScheduled')

  const first = formatTimelineDateValue(dates[0]!, activeLocale)
  const last = formatTimelineDateValue(dates[dates.length - 1]!, activeLocale)
  const dateRange = first === last ? first : `${first} - ${last}`
  if (unscheduledCount === 0) return dateRange
  return t(
    unscheduledCount === 1
      ? 'designReport.timeline.dateRangeWithUnscheduledOne'
      : 'designReport.timeline.dateRangeWithUnscheduledMany',
    { dateRange, count: unscheduledCount },
  )
}

function timelineActionHasScheduledDate(action: TimelineAction): boolean {
  return isValidTimelineDate(action.start_date) || isValidTimelineDate(action.end_date)
}

function isValidTimelineDate(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value))
}

function formatTimelineDateValue(
  value: string | null,
  activeLocale: string,
): string {
  if (!value) return t('designReport.timeline.notScheduled')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(activeLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function timelineTargetsLabel(
  targets: readonly PanelTarget[],
  file: CanopiFile,
  localizedNames: ReadonlyMap<string, string | null>,
): string {
  if (targets.length === 0) return t('designReport.timeline.none')
  const labels = targets
    .map((target) => timelineTargetLabel(target, file, localizedNames))
    .filter(nonEmptyString)
  return labels.length > 0 ? labels.join(', ') : t('designReport.timeline.none')
}

function timelineTargetLabel(
  target: PanelTarget,
  file: CanopiFile,
  localizedNames: ReadonlyMap<string, string | null>,
): string | null {
  switch (target.kind) {
    case 'species':
      return localizedSpeciesName(target.canonical_name, file, localizedNames)
    case 'placed_plant': {
      const plant = file.plants.find((candidate) => candidate.id === target.plant_id)
      return plant ? localizedPlantName(plant, localizedNames) : null
    }
    case 'zone':
      return target.zone_name
    case 'manual':
      return t('designReport.timeline.manual')
    case 'none':
      return t('designReport.timeline.none')
  }
}

function localizedSpeciesName(
  canonicalName: string,
  file: CanopiFile,
  localizedNames: ReadonlyMap<string, string | null>,
): string {
  const plant = file.plants.find((candidate) => candidate.canonical_name === canonicalName)
  return localizedNames.get(canonicalName) ?? plant?.common_name ?? canonicalName
}

function buildBudgetInput(
  file: CanopiFile,
  querySurface: CanvasQuerySurface | null,
): DesignReportBudgetInput | null {
  if (file.budget.length === 0 && file.budget_currency === DEFAULT_BUDGET_CURRENCY) return null

  const activeLocale = locale.value
  const localizedNames = querySurface?.getLocalizedCommonNames() ?? new Map<string, string | null>()
  const rowComputations = file.budget.map((item) => reportBudgetRow(item, file, localizedNames, activeLocale))
  const rows = rowComputations.map((row) => row.input)
  const totals = buildBudgetTotals(rowComputations, activeLocale)
  if (rows.length === 0 && totals.length === 0) {
    totals.push({
      label: t('canvas.budget.grandTotal'),
      currency: file.budget_currency,
      amount: formatBudgetCurrency(0, file.budget_currency, activeLocale),
    })
  }

  return {
    title: t('canvas.budget.title'),
    columns: {
      target: t('designReport.budget.target'),
      category: t('designReport.budget.category'),
      description: t('canvas.budget.description'),
      quantity: t('canvas.budget.quantity'),
      unit_cost: t('canvas.budget.unitCost'),
      line_total: t('canvas.budget.lineTotal'),
      currency: t('canvas.budget.currency'),
    },
    rows,
    totals,
  }
}

function reportBudgetRow(
  item: BudgetItem,
  file: CanopiFile,
  localizedNames: ReadonlyMap<string, string | null>,
  activeLocale: string,
): BudgetReportRowComputation {
  const currency = item.currency || file.budget_currency
  const quantity = budgetItemQuantity(item, file)
  const lineTotal = quantity * item.unit_cost

  return {
    currency,
    lineTotal,
    input: {
      target: timelineTargetLabel(item.target, file, localizedNames) ?? t('designReport.timeline.none'),
      category: budgetCategoryLabel(item.category),
      description: nonEmptyString(item.description) ?? '',
      quantity: formatReportNumber(quantity, activeLocale),
      unit_cost: formatBudgetCurrency(item.unit_cost, currency, activeLocale),
      line_total: formatBudgetCurrency(lineTotal, currency, activeLocale),
      currency,
    },
  }
}

function budgetItemQuantity(item: BudgetItem, file: CanopiFile): number {
  const { target } = item
  if (item.category === 'plants' && target.kind === 'species') {
    const count = file.plants.filter((plant) => plant.canonical_name === target.canonical_name).length
    if (count > 0) return count
  }
  return item.quantity
}

function buildBudgetTotals(
  rows: readonly BudgetReportRowComputation[],
  activeLocale: string,
): DesignReportBudgetTotalInput[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.lineTotal)
  }
  return [...totals.entries()].map(([currency, amount]) => ({
    label: t('canvas.budget.grandTotal'),
    currency,
    amount: formatBudgetCurrency(amount, currency, activeLocale),
  }))
}

function buildConsortiumInput(
  file: CanopiFile,
  querySurface: CanvasQuerySurface | null,
): DesignReportConsortiumInput | null {
  const localizedNames = querySurface?.getLocalizedCommonNames() ?? new Map<string, string | null>()
  const projection = buildConsortiumPlanningProjection({
    consortiums: file.consortiums,
    plants: file.plants,
    speciesColors: file.plant_species_colors,
    localizedNames,
  })
  if (projection.activeEntries.length === 0) return null
  if (!projection.activeEntries.some(hasNonDefaultConsortiumValues)) return null

  const activeLocale = locale.value
  const phases = CONSORTIUM_SUCCESSION_PHASES.map((phase) => t(phase.labelKey))
  const bars = [...projection.bars].sort(compareConsortiumBars)

  return {
    title: t('canvas.consortium.title'),
    chart_title: t('designReport.consortium.chart'),
    table_title: t('designReport.consortium.table'),
    phases,
    columns: {
      plant: t('designReport.consortium.plant'),
      canonical_name: t('designReport.consortium.canonicalName'),
      stratum: t('designReport.consortium.stratum'),
      start_phase: t('designReport.consortium.startPhase'),
      end_phase: t('designReport.consortium.endPhase'),
      count: t('designReport.consortium.count'),
    },
    chart_rows: buildConsortiumChartRows(bars),
    rows: bars.map((bar) => reportConsortiumRow(bar, activeLocale)),
  }
}

function hasNonDefaultConsortiumValues(entry: Consortium): boolean {
  return (
    entry.stratum !== DEFAULT_CONSORTIUM_STRATUM ||
    entry.start_phase !== DEFAULT_CONSORTIUM_START_PHASE ||
    entry.end_phase !== DEFAULT_CONSORTIUM_END_PHASE
  )
}

function buildConsortiumChartRows(
  bars: readonly ConsortiumPlanningBar[],
): DesignReportConsortiumChartRowInput[] {
  const rows: DesignReportConsortiumChartRowInput[] = []
  for (const stratum of CONSORTIUM_STRATA) {
    const stratumBars = bars.filter((bar) => bar.stratum === stratum)
    if (stratumBars.length === 0) continue
    rows.push({
      stratum: consortiumStratumLabel(stratum),
      cells: CONSORTIUM_SUCCESSION_PHASES.map((_, phaseIndex) => ({
        entries: stratumBars
          .filter((bar) => bar.startPhase <= phaseIndex && bar.endPhase >= phaseIndex)
          .map((bar) => ({
            label: bar.commonName,
            color: bar.color,
          })),
      })),
    })
  }
  return rows
}

function reportConsortiumRow(
  bar: ConsortiumPlanningBar,
  activeLocale: string,
): DesignReportConsortiumRowInput {
  return {
    plant: bar.commonName,
    canonical_name: bar.commonName === bar.canonicalName ? null : bar.canonicalName,
    stratum: consortiumStratumLabel(bar.stratum),
    start_phase: consortiumPhaseLabel(bar.startPhase),
    end_phase: consortiumPhaseLabel(bar.endPhase),
    count: formatReportNumber(bar.count, activeLocale),
  }
}

function compareConsortiumBars(left: ConsortiumPlanningBar, right: ConsortiumPlanningBar): number {
  return (
    stratumToRow(left.stratum) - stratumToRow(right.stratum)
    || left.startPhase - right.startPhase
    || left.endPhase - right.endPhase
    || left.commonName.localeCompare(right.commonName)
    || left.canonicalName.localeCompare(right.canonicalName)
  )
}

function consortiumStratumLabel(stratum: string): string {
  const key = (CONSORTIUM_STRATA as readonly string[]).includes(stratum) ? stratum : DEFAULT_CONSORTIUM_STRATUM
  return t(`canvas.consortium.${key}`)
}

function consortiumPhaseLabel(phaseIndex: number): string {
  const phase = CONSORTIUM_SUCCESSION_PHASES[clampSuccessionPhaseIndex(phaseIndex)]
  return phase ? t(phase.labelKey) : String(phaseIndex + 1)
}

function formatReportNumber(value: number, activeLocale: string): string {
  return new Intl.NumberFormat(activeLocale, {
    maximumFractionDigits: 2,
  }).format(value)
}

function isLayerVisible(file: CanopiFile, layerName: string): boolean {
  return file.layers.find((layer) => layer.name === layerName)?.visible !== false
}

const REPORT_LAYER_LABEL_KEYS: Record<string, string> = {
  annotations: 'canvas.layers.annotations',
  base: 'canvas.layers.basemap',
  climate: 'canvas.layers.climate',
  contours: 'canvas.layers.contours',
  'measurement-guides': 'canvas.layers.measurement-guides',
  plants: 'canvas.layers.plants',
  zones: 'canvas.layers.zones',
  water: 'canvas.layers.water',
  hillshading: 'canvas.terrain.hillshade',
}

const PLANT_COLOR_BY_ATTRIBUTE_LABEL_KEYS: Record<string, string> = {
  edibility: 'canvas.display.edibility',
  flower: 'canvas.display.flower',
  hardiness: 'canvas.display.hardiness',
  lifecycle: 'canvas.display.lifecycle',
  nitrogen: 'canvas.display.nitrogen',
  stratum: 'canvas.display.stratum',
}

const BUDGET_CATEGORY_LABEL_KEYS: Record<string, string> = {
  labor: 'designReport.budget.categories.labor',
  materials: 'designReport.budget.categories.materials',
  plants: 'designReport.budget.categories.plants',
  tools: 'designReport.budget.categories.tools',
}

function reportLayerLabel(layerName: string): string {
  return localizedKeyOrHumanized(REPORT_LAYER_LABEL_KEYS[layerName], layerName)
}

function plantColorByAttributeLabel(attribute: string): string {
  return localizedKeyOrHumanized(PLANT_COLOR_BY_ATTRIBUTE_LABEL_KEYS[attribute], attribute)
}

function budgetCategoryLabel(category: string): string {
  return localizedKeyOrHumanized(BUDGET_CATEGORY_LABEL_KEYS[category], category)
}

function timelineDependenciesLabel(dependencies: readonly string[] | null | undefined): string {
  const count = dependencies?.filter((dependency) => nonEmptyString(dependency) !== null).length ?? 0
  if (count === 0) return t('designReport.timeline.none')
  if (count === 1) return t('designReport.timeline.dependencyCountOne', { count })
  return t('designReport.timeline.dependencyCountMany', { count })
}

function localizedKeyOrHumanized(key: string | undefined, fallbackValue: string): string {
  if (!key) return humanizeReportToken(fallbackValue)
  const translated = t(key)
  return translated === key ? humanizeReportToken(fallbackValue) : translated
}

function humanizeReportToken(value: string): string {
  const words = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return value
  return words
    .map((word) => word.charAt(0).toLocaleUpperCase(locale.value) + word.slice(1))
    .join(' ')
}

function choosePageOrientation(bounds: DesignReportBounds | null): DesignReportPageOrientation {
  if (!bounds) return 'portrait'
  return bounds.max_x - bounds.min_x > bounds.max_y - bounds.min_y ? 'landscape' : 'portrait'
}

function computeReportBounds(
  plants: readonly DesignReportPlantInput[],
  zones: readonly DesignReportZoneInput[],
  annotations: readonly DesignReportAnnotationInput[],
  measurementGuides: readonly DesignReportMeasurementGuideInput[],
): DesignReportBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const plant of plants) {
    const radius = plant.radius_m ?? 0
    includePoint(plant.x - radius, plant.y - radius)
    includePoint(plant.x + radius, plant.y + radius)
  }
  for (const zone of zones) {
    for (const point of zone.points) includePoint(point.x, point.y)
  }
  for (const annotation of annotations) includePoint(annotation.x, annotation.y)
  for (const guide of measurementGuides) {
    includePoint(guide.start.x, guide.start.y)
    includePoint(guide.end.x, guide.end.y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY }
}

function defaultReportFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned || 'Untitled Design'} Design Report.pdf`
}

function nonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function localizedPlantName(
  plant: PlacedPlant,
  localizedNames: ReadonlyMap<string, string | null>,
): string {
  return localizedNames.get(plant.canonical_name) ?? plant.common_name ?? plant.canonical_name
}

function renderDesignReportCanvasImage(
  request: DesignReportCanvasImageRenderRequest,
): DesignReportCanvasImageInput | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  const dimensions = reportCanvasImageDimensions(request.bounds, request.page)
  canvas.width = dimensions.widthPx
  canvas.height = dimensions.heightPx

  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const viewport = reportCanvasImageViewport(request.bounds, dimensions.widthPx, dimensions.heightPx)
    const speciesCache = new Map()
    const plantContext = {
      viewport,
      sizeMode: request.sizeMode,
      colorByAttr: request.colorByAttr,
      speciesCache,
      plantSpeciesSymbols: request.scene.plantSpeciesSymbols,
      localizedCommonNames: request.localizedNames,
    }
    const snapshot: SceneRendererSnapshot = {
      scene: request.scene,
      viewport,
      selectedPlantIds: new Set<string>(),
      selectedZoneIds: new Set<string>(),
      selectedAnnotationIds: new Set<string>(),
      selectedMeasurementGuideIds: new Set<string>(),
      highlightedPlantIds: new Set<string>(),
      highlightedZoneIds: new Set<string>(),
      sizeMode: request.sizeMode,
      colorByAttr: request.colorByAttr,
      speciesCache,
      localizedCommonNames: request.localizedNames,
      hoveredCanonicalName: null,
      pinnedPlantNameLabels: computePinnedPlantNameLabels(
        request.scene.plants,
        viewport,
        request.localizedNames,
        { plantContext },
      ),
      selectionLabels: [],
    }

    renderCanvas2DSceneSnapshot(ctx, snapshot, {
      widthPx: dimensions.widthPx,
      heightPx: dimensions.heightPx,
      background: request.background,
    })
    const dataUrl = canvas.toDataURL('image/png')
    const payload = dataUrl.startsWith('data:image/png;base64,')
      ? dataUrl.slice('data:image/png;base64,'.length)
      : null
    if (!payload) return null
    return {
      data_base64: payload,
      width_px: dimensions.widthPx,
      height_px: dimensions.heightPx,
    }
  } catch {
    return null
  }
}

function reportCanvasImageDimensions(
  bounds: DesignReportBounds,
  page: DesignReportCanvasPageInput,
): { widthPx: number; heightPx: number } {
  const maxWidthPx = Math.max(1, Math.round((page.width_mm - page.margin_mm * 2) * REPORT_CANVAS_IMAGE_PX_PER_MM))
  const maxHeightPx = Math.max(1, Math.round((page.height_mm - page.margin_mm * 2) * REPORT_CANVAS_IMAGE_PX_PER_MM))
  const boundsWidth = Math.max(bounds.max_x - bounds.min_x, 1)
  const boundsHeight = Math.max(bounds.max_y - bounds.min_y, 1)
  const aspectRatio = boundsWidth / boundsHeight
  let widthPx = maxWidthPx
  let heightPx = Math.max(1, Math.round(widthPx / aspectRatio))

  if (heightPx > maxHeightPx) {
    heightPx = maxHeightPx
    widthPx = Math.max(1, Math.round(heightPx * aspectRatio))
  }

  return { widthPx, heightPx }
}

function reportCanvasImageViewport(
  bounds: DesignReportBounds,
  widthPx: number,
  heightPx: number,
): SceneViewportState {
  const paddingRatio = 0.08
  const contentWidth = Math.max(bounds.max_x - bounds.min_x, 1)
  const contentHeight = Math.max(bounds.max_y - bounds.min_y, 1)
  const scale = Math.min(
    (widthPx * (1 - paddingRatio * 2)) / contentWidth,
    (heightPx * (1 - paddingRatio * 2)) / contentHeight,
  )

  return {
    x: (widthPx - contentWidth * scale) / 2 - bounds.min_x * scale,
    y: (heightPx - contentHeight * scale) / 2 - bounds.min_y * scale,
    scale,
  }
}
