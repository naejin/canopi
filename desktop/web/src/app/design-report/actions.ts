import { getCurrentCanvasDocumentSurface, getCurrentCanvasQuerySurface } from '../../canvas/session'
import type { CanvasDocumentSurface, CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { getLegendEntries } from '../../canvas/display-modes'
import { actionColor } from '../../canvas/timeline-renderer'
import { buildPinnedPlantNameLegendEntries } from '../../canvas/pinned-plant-name-legend'
import { hydrateScenePersistedState } from '../../canvas/runtime/scene/codec'
import { formatMetricDistance } from '../../canvas/runtime/zone-measurements'
import { ACTION_TYPES } from '../planning-projection/timeline'
import { locale } from '../settings/state'
import { formatBudgetCurrency } from '../budget/formatting'
import { buildPersistedDesignSessionContent } from '../document-session/persistence'
import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import type { Annotation, BudgetItem, CanopiFile, Location, MeasurementGuide, PanelTarget, PlacedPlant, TimelineAction, Zone } from '../../types/design'
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
  readonly legend: DesignReportCanvasLegendInput | null
}

export interface DesignReportInput {
  readonly title: string
  readonly metadata: DesignReportMetadataInput
  readonly canvas: DesignReportCanvasInput
  readonly timeline: DesignReportTimelineInput | null
  readonly budget: DesignReportBudgetInput | null
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

interface BudgetReportRowComputation {
  readonly input: DesignReportBudgetRowInput
  readonly currency: string
  readonly lineTotal: number
}

interface CurrentDesignReportOptions {
  readonly session?: CanvasDocumentSurface | null
  readonly querySurface?: CanvasQuerySurface | null
  readonly store?: DesignSessionStore
}

interface DesignReportInputOptions {
  readonly querySurface?: CanvasQuerySurface | null
}

const A4_PORTRAIT = { width_mm: 210, height_mm: 297 } as const
const REPORT_MARGIN_MM = 14

export function buildDesignReportInput(
  file: CanopiFile,
  options: DesignReportInputOptions = {},
): DesignReportInput {
  const canvas = buildCanvasInput(file, options.querySurface ?? null)
  const timeline = buildTimelineInput(file, options.querySurface ?? null)
  const budget = buildBudgetInput(file, options.querySurface ?? null)
  const description = nonEmptyString(file.description)

  return {
    title: nonEmptyString(file.name) ?? 'Untitled Design',
    metadata: {
      ...(description ? { description } : {}),
      ...(file.location ? { location: file.location } : {}),
    },
    canvas,
    timeline,
    budget,
  }
}

export function buildCurrentDesignReportInput({
  session = getCurrentCanvasDocumentSurface(),
  querySurface = getCurrentCanvasQuerySurface(),
  store = designSessionStore,
}: CurrentDesignReportOptions = {}): DesignReportInput | null {
  if (!store.hasCurrentDesign()) return null

  const file = buildPersistedDesignSessionContent({
    session,
    name: store.readDesignName(),
    store,
  })
  return buildDesignReportInput(file, { querySurface })
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

  return {
    page,
    bounds,
    visible_layer_names: file.layers
      .filter((layer) => layer.visible)
      .map((layer) => layer.name),
    plants,
    zones,
    annotations,
    measurement_guides: measurementGuides,
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
      attribute: colorByAttr,
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
    description: action.description,
    start_date: formatTimelineDateValue(action.start_date, activeLocale),
    end_date: formatTimelineDateValue(action.end_date, activeLocale),
    recurrence: nonEmptyString(action.recurrence) ?? t('designReport.timeline.none'),
    target: timelineTargetsLabel(action.targets, file, localizedNames),
    dependencies: action.depends_on && action.depends_on.length > 0
      ? action.depends_on.join(', ')
      : t('designReport.timeline.none'),
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
  const dates = actions
    .flatMap((action) => [action.start_date, action.end_date])
    .filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)))
    .sort()
  if (dates.length === 0) return t('designReport.timeline.notScheduled')

  const first = formatTimelineDateValue(dates[0]!, activeLocale)
  const last = formatTimelineDateValue(dates[dates.length - 1]!, activeLocale)
  return first === last ? first : `${first} - ${last}`
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
      return plant ? localizedPlantName(plant, localizedNames) : target.plant_id
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
      category: item.category,
      description: item.description,
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

function formatReportNumber(value: number, activeLocale: string): string {
  return new Intl.NumberFormat(activeLocale, {
    maximumFractionDigits: 2,
  }).format(value)
}

function isLayerVisible(file: CanopiFile, layerName: string): boolean {
  return file.layers.find((layer) => layer.name === layerName)?.visible !== false
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
