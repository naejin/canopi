import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisEntry, AnalysisGroup } from '../generated/analysis-registry'
import type { AnalysisOffer, AnalysisRequest } from '../generated/contracts'
import type { AnalysisContext } from '../app/analyses/model'
import { AnalyzeDialog } from '../components/panels/analyze/AnalyzeDialog'
import { locale } from '../app/settings/state'
import { slopeProvenance } from './support/library-fixtures'

const water = 'water' as unknown as AnalysisGroup

/** Every parameter type, an advanced disclosure, visibleWhen and optional outputs. */
const FLOW: AnalysisEntry = {
  id: 'hydrology.flow',
  version: 1,
  group: water,
  titleKey: 'fixture.flow.title',
  summaryKey: 'fixture.flow.summary',
  lane: { kind: 'geolibre-windowed', halo: 0 },
  inputs: [{ key: 'dem', accepts: [{ kind: 'Raster', quantity: 'GroundElevation' }], requires: [] }],
  params: [
    {
      key: 'depressions', labelKey: 'fixture.depressions', helpKey: 'fixture.depressionsHelp',
      kind: { type: 'choice', options: ['breach', 'fill'] }, default: 'breach', advanced: false, visibleWhen: null,
      optionLabelKeys: { breach: 'fixture.breach', fill: 'fixture.fill' },
    },
    {
      key: 'max_breach_m', labelKey: 'fixture.maxBreach', helpKey: 'fixture.maxBreachHelp',
      kind: { type: 'number', min: 1, max: 1000, step: 1, unit: 'metre' }, default: 50, advanced: true,
      visibleWhen: { param: 'depressions', equals: 'breach' }, optionLabelKeys: {},
    },
    {
      key: 'passes', labelKey: 'fixture.passes', helpKey: 'fixture.passesHelp',
      kind: { type: 'integer', min: 1, max: 5 }, default: 2, advanced: false, visibleWhen: null, optionLabelKeys: {},
    },
    {
      key: 'log', labelKey: 'fixture.log', helpKey: 'fixture.logHelp',
      kind: { type: 'boolean' }, default: true, advanced: false, visibleWhen: null, optionLabelKeys: {},
    },
  ],
  outputs: [
    { key: 'area', labelKey: 'fixture.area', item: { kind: 'Raster', quantity: 'OtherContinuous' }, units: { kind: 'fixed', value: 'm²' }, optional: true, defaultSelected: true, presentable: true },
    { key: 'wetness', labelKey: 'fixture.wetness', item: { kind: 'Raster', quantity: 'OtherContinuous' }, units: { kind: 'fixed', value: '' }, optional: true, defaultSelected: false, presentable: true },
  ],
}

const SLOPE: AnalysisEntry = {
  ...FLOW,
  id: 'terrain.slope',
  group: 'terrain',
  titleKey: 'analyses.terrain.slope.title',
  summaryKey: 'analyses.terrain.slope.summary',
  params: [{
    key: 'unit', labelKey: 'analyses.terrain.slope.params.unit.label', helpKey: 'analyses.terrain.slope.params.unit.help',
    kind: { type: 'choice', options: ['degrees', 'percent'] }, default: null, advanced: false, visibleWhen: null,
    optionLabelKeys: { degrees: 'analyses.terrain.slope.params.unit.options.degrees', percent: 'analyses.terrain.slope.params.unit.options.percent' },
  }],
  outputs: [{ key: 'slope', labelKey: 'analyses.terrain.slope.outputs.slope', item: { kind: 'Raster', quantity: 'Slope' }, units: { kind: 'by-param', param: 'unit', map: { degrees: '°', percent: '%' } }, optional: false, defaultSelected: true, presentable: true }],
}

const REGISTRY = [SLOPE, FLOW]
const GROUPS = [{ key: 'terrain' as AnalysisGroup, labelKey: 'analyses.groups.terrain' }, { key: water, labelKey: 'fixture.water' }]
const OFFERS: AnalysisOffer[] = [
  { analysis_id: 'terrain.slope', unavailable: null },
  { analysis_id: 'hydrology.flow', unavailable: null },
]

let container: HTMLDivElement
const onRun = vi.fn<(request: AnalysisRequest) => void>()
const onCancel = vi.fn()
const onShowInLayers = vi.fn()
const onAddExisting = vi.fn()

function mount(options: { context?: Partial<AnalysisContext>; offers?: AnalysisOffer[]; initial?: string | null } = {}): void {
  const context: AnalysisContext = { edition: 'desktop', results: [], inDesign: new Set(), ...options.context }
  act(() => {
    render(
      <AnalyzeDialog
        item={{ id: 'ground', name: 'Ground', offers: options.offers ?? OFFERS }}
        context={context}
        attach={false}
        canAddToDesign
        initialAnalysisId={options.initial ?? null}
        busy={false}
        error={null}
        onCancel={onCancel}
        onRun={onRun}
        onShowInLayers={onShowInLayers}
        onAddExisting={onAddExisting}
        registry={REGISTRY}
        groups={GROUPS}
      />,
      container,
    )
  })
}

function radio(label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .find((input) => input.closest('label')?.textContent?.includes(label))
  if (!found) throw new Error(`no radio ${label}`)
  return found
}

function field(label: string): HTMLInputElement {
  const target = Array.from(container.querySelectorAll('label')).find((node) => node.textContent === label)
  const input = target ? document.getElementById(target.htmlFor) as HTMLInputElement | null : null
  if (!input) throw new Error(`no field ${label}`)
  return input
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('Analyze dialog', () => {
  beforeEach(() => {
    locale.value = 'en'
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('lists the registry by group and focuses the chosen entry', async () => {
    mount({ initial: 'hydrology.flow' })
    await act(async () => {})
    expect(Array.from(container.querySelectorAll('legend')).slice(0, 2).map((node) => node.textContent)).toEqual(['Terrain', 'fixture.water'])
    expect(document.activeElement).toBe(radio('fixture.flow.title'))
    expect(radio('fixture.flow.title').checked).toBe(true)
  })

  it('renders parameters by type, advanced ones in a disclosure, and honours visibleWhen', async () => {
    mount({ initial: 'hydrology.flow' })
    expect(radio('fixture.breach').checked).toBe(true)
    expect(field('fixture.passes').value).toBe('2')
    expect(container.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(true)
    const advanced = container.querySelector('details')!
    expect(advanced.querySelector('summary')?.textContent).toBe('Advanced settings')
    const max = field('fixture.maxBreach')
    expect(advanced.contains(max)).toBe(true)
    expect(max.value).toBe('50')
    expect(max.getAttribute('aria-describedby')).toContain(`${max.id}-unit`)
    expect(document.getElementById(`${max.id}-unit`)?.textContent).toBe('m')

    await act(async () => { radio('fixture.fill').click() })
    expect(container.querySelector('details')).toBeNull()
  })

  it('builds the request from the form: typed values, hidden parameters omitted, chosen outputs', async () => {
    mount({ initial: 'hydrology.flow' })
    await act(async () => { radio('fixture.fill').click() })
    await act(async () => { container.querySelector<HTMLInputElement>('input[role="switch"]')!.click() })
    const wetness = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([role])'))
      .find((input) => input.closest('label')?.textContent === 'fixture.wetness')!
    await act(async () => { wetness.click() })
    const name = container.querySelector<HTMLInputElement>('input:not([type])')!
    await type(name, 'Flow paths')
    await submit()

    expect(onRun).toHaveBeenCalledWith({
      analysis_id: 'hydrology.flow',
      inputs: [{ key: 'dem', item_id: 'ground' }],
      parameters: [
        { key: 'depressions', value: { Choice: 'fill' } },
        { key: 'passes', value: { Integer: 2 } },
        { key: 'log', value: { Boolean: false } },
      ],
      outputs: ['area', 'wetness'],
      name: 'Flow paths',
    })
  })

  it('explains invalid values inline and does not run', async () => {
    mount({ initial: 'hydrology.flow' })
    const passes = field('fixture.passes')
    await type(passes, '9')
    expect(container.textContent).toContain('Enter a value from 1 to 5.')
    expect(passes.getAttribute('aria-invalid')).toBe('true')
    await submit()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('names why each unavailable entry cannot run', () => {
    mount({ offers: [
      { analysis_id: 'terrain.slope', unavailable: { reason: 'ValuesNotMetres', units: 'ft' } },
      { analysis_id: 'hydrology.flow', unavailable: { reason: 'GridNotProjectedMetres' } },
    ] })
    expect(container.textContent).toContain('Needs values in metres; this data is in ft.')
    expect(container.textContent).toContain('Needs a projected grid in metres.')
    const run = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Run')!
    expect(run.disabled).toBe(true)
  })

  it('says every analysis needs Desktop on Web', () => {
    mount({ context: { edition: 'web' } })
    expect(container.querySelectorAll('[class*="reason"]')).toHaveLength(2)
    expect(container.textContent).toContain('Needs Canopi Desktop.')
  })

  it('offers Show in Layers instead of Run for a result the Design already shows', async () => {
    mount({ context: { results: [{ id: 'slope-1', provenance: slopeProvenance('slope-1', 'ground') }], inDesign: new Set(['slope-1']) } })
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Run')).toBe(true)
    await act(async () => { radio('Degrees').click() })

    expect(container.textContent).toContain('Already in Layers.')
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Run')).toBe(false)
    await submit()
    expect(onShowInLayers).toHaveBeenCalledWith('slope-1')
    expect(onRun).not.toHaveBeenCalled()
  })

  it('marks an entry already in Layers when its default settings match', () => {
    const results = [{ id: 'flow-1', provenance: slopeProvenance('flow-1', 'ground', { analysis_id: 'hydrology.flow', parameters: [] }) }]
    mount({ context: { results, inDesign: new Set(['flow-1']) } })
    expect(container.textContent).toContain('Already in Layers.')
  })

  it('cancels with Escape', async () => {
    mount()
    await act(async () => {
      radio('Slope').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
