import type { LibraryItemSummary, LibrarySnapshot, Provenance } from '../../generated/contracts'

/** A ready ground-elevation source, as the native snapshot reports it. */
export function sourceItem(id: string, name: string, overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  return {
    id,
    name,
    role: 'Source',
    item_type: { kind: 'Raster', quantity: 'GroundElevation' },
    units: 'm',
    state: 'Ready',
    generation_id: `${id}-g1`,
    bounds: [0, 0, 1, 1],
    value_range: [10, 20],
    display_range: null,
    resolution_m: 1,
    coverage_cells: null,
    import_job: null,
    provenance: null,
    freshness: { state: 'Current' },
    run: null,
    offers: [{ analysis_id: 'terrain.slope', unavailable: null }],
    dependents: 0,
    ...overrides,
  }
}

export function slopeProvenance(id: string, input: string, overrides: Partial<Provenance> = {}): Provenance {
  return {
    definition_id: `${id}-def`,
    analysis_id: 'terrain.slope',
    recipe_version: 1,
    output_key: 'slope',
    inputs: [{ key: 'dem', item_id: input, generation_id: `${input}-g1` }],
    parameters: [{ key: 'unit', value: { Choice: 'degrees' } }],
    tool: { engine: 'geolibre', version: 'geolibre-cli 1.5.3', revision: 'aac2b743978612345678', tools: ['slope'] },
    job_id: `${id}-job`,
    created_at: '1790000000000',
    ...overrides,
  }
}

/** A published unnamed slope in degrees calculated from `input`. */
export function slopeItem(id: string, input: string, overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  return {
    ...sourceItem(id, '', {
      name: null,
      role: 'Derived',
      item_type: { kind: 'Raster', quantity: 'Slope' },
      units: '°',
      value_range: [0, 40],
      resolution_m: 1,
      provenance: slopeProvenance(id, input),
      run: { job_id: `${id}-job`, state: 'Complete', message: null },
      offers: [{ analysis_id: 'terrain.slope', unavailable: { reason: 'WrongInput', expected: [{ kind: 'Raster', quantity: 'GroundElevation' }] } }],
    }),
    ...overrides,
  }
}

export function librarySnapshot(items: LibraryItemSummary[], geolibre = true): LibrarySnapshot {
  return {
    items,
    engines: {
      gdal: { available: true, version: '3.8.4', detail: null },
      geolibre: geolibre
        ? { available: true, version: 'geolibre-cli 1.5.3', detail: null }
        : { available: false, version: null, detail: 'not installed' },
    },
  }
}
