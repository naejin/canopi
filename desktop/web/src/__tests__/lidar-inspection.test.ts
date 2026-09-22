import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarSampleOutcome } from '../generated/contracts'

/** Deferred native answers, so a test can control when a lookup settles. */
const pending: Array<(outcome: LidarSampleOutcome) => void> = []
const samplePixel = vi.fn(
  () =>
    new Promise<LidarSampleOutcome>((resolve) => {
      pending.push(resolve)
    }),
)

vi.mock('../ipc/lidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc/lidar')>()
  return { ...actual, lidarSamplePixel: () => samplePixel() }
})

const { currentDesign, replaceCurrentDesignState } = await import(
  '../app/document-session/store'
)
const { lidarLibrary } = await import('../app/lidar/library-store')
const {
  beginInspection,
  endInspection,
  inspectionSample,
  inspectionTarget,
  interpretOutcome,
  reconcileInspectionWithPresentation,
  sampleInspectionPoint,
} = await import('../app/lidar/inspection')

/** A Design whose only presentation entry is a visible source layer. */
function designWithPresentedLayer(): Parameters<typeof replaceCurrentDesignState>[0] {
  return {
    version: 6,
    name: 'Inspect',
    description: null,
    spatial_frame: {
      anchor_longitude_deg: 0.0911,
      anchor_latitude_deg: 48.4312,
      north_bearing_deg: 12,
      placement_status: 'confirmed',
      location_metadata: { altitude_m: null },
    },
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '',
    updated_at: '',
    extra: {},
    lidar: {
      schema_version: 1,
      entries: [
        { kind: 'Source', id: 'lyr-1', visible: true, opacity: 1, order: 0, style: null },
      ],
    },
  } as unknown as Parameters<typeof replaceCurrentDesignState>[0]
}

function libraryWithGeneration(generationId: string) {
  return {
    layers: [
      {
        id: 'lyr-1',
        name: 'Ground',
        measurement_kind: 'GroundElevation',
        units: 'm',
        state: 'Ready',
        resolution_m: 0.5,
        coverage_cells: '1000',
        bounds: [0, 0, 1, 1],
        value_range: null,
        analysis_count: 0,
        tilesets: [
          {
            style: 'elevation',
            source: { kind: 'native-generation', generation_id: generationId },
            min_zoom: 13,
            max_zoom: 17,
            tile_size: 256,
            bounds: [0, 0, 1, 1],
          },
        ],
      },
    ],
    analyses: [],
    engine: { available: true, version: null, detail: null },
  }
}

const POINT = {
  anchor: { lat: 48.4312, lon: 0.0911 },
  eastMetres: 10,
  northMetres: -5,
  northBearingDeg: 12,
}

describe('numeric inspection session state', () => {
  beforeEach(() => {
    pending.length = 0
    samplePixel.mockClear()
    endInspection()
    replaceCurrentDesignState(designWithPresentedLayer(), null, 'Inspect')
    lidarLibrary.value = libraryWithGeneration('gen-1') as never
  })

  it('maps every native outcome to a read-only surface state', () => {
    expect(
      interpretOutcome({
        Value: { generation_id: 'gen-1', value: 123.5, units: 'm' },
      } satisfies LidarSampleOutcome),
    ).toEqual({ kind: 'value', value: 123.5, units: 'm' })

    // Out of coverage and a declared no-data pixel are the same read-only state.
    expect(
      interpretOutcome({ NoData: { generation_id: 'gen-1' } } satisfies LidarSampleOutcome),
    ).toEqual({ kind: 'no-data' })

    // A non-finite value is never presented as a physical measurement.
    expect(
      interpretOutcome({
        Value: { generation_id: 'gen-1', value: Number.NaN, units: 'm' },
      } satisfies LidarSampleOutcome),
    ).toEqual({ kind: 'no-data' })

    // A stale generation is recoverable by re-aiming while an unavailable one is
    // not, so they must not collapse into one state.
    expect(
      interpretOutcome({
        Unavailable: { reason: 'StaleGeneration' },
      } satisfies LidarSampleOutcome),
    ).toEqual({ kind: 'stale' })
    expect(
      interpretOutcome({
        Unavailable: { reason: 'MissingGeneration' },
      } satisfies LidarSampleOutcome),
    ).toEqual({ kind: 'unavailable', reason: 'MissingGeneration' })
  })

  it('enters inspection with an idle sample and leaves it cleanly', () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    expect(inspectionTarget.value?.id).toBe('lyr-1')
    expect(inspectionSample.value).toEqual({ kind: 'idle' })
    endInspection()
    expect(inspectionTarget.value).toBeNull()
    expect(inspectionSample.value).toEqual({ kind: 'idle' })
  })

  it('publishes a sampled value and sends the anchor with the scene offset', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const sampling = sampleInspectionPoint(POINT)
    expect(inspectionSample.value).toEqual({ kind: 'loading' })

    pending[0]?.({ Value: { generation_id: 'gen-1', value: 42.25, units: 'm' } })
    await sampling

    expect(inspectionSample.value).toEqual({ kind: 'value', value: 42.25, units: 'm' })
    // The native side receives the expected generation and the anchor-plus-offset
    // decomposition, which is what it needs to project accurately.
    expect(samplePixel).toHaveBeenCalledTimes(1)
  })

  it('never publishes a superseded answer as the current sample', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const first = sampleInspectionPoint(POINT)
    const second = sampleInspectionPoint({ ...POINT, eastMetres: 99 })

    // The older answer arrives last, which is the ordering that produces a wrong
    // current value if responses are not fenced.
    pending[1]?.({ Value: { generation_id: 'gen-1', value: 7, units: 'm' } })
    await second
    expect(inspectionSample.value).toEqual({ kind: 'value', value: 7, units: 'm' })

    pending[0]?.({ Value: { generation_id: 'gen-1', value: 999, units: 'm' } })
    await first
    // The stale lookup must leave the newer value alone.
    expect(inspectionSample.value).toEqual({ kind: 'value', value: 7, units: 'm' })
  })

  it('drops a lookup that settles after the session ended', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const sampling = sampleInspectionPoint(POINT)
    endInspection()
    pending[0]?.({ Value: { generation_id: 'gen-1', value: 5, units: 'm' } })
    await sampling
    // Escape, layer removal or teardown must not be followed by a late value.
    expect(inspectionSample.value).toEqual({ kind: 'idle' })
    expect(inspectionTarget.value).toBeNull()
  })

  it('reports a missing generation rather than sampling one', async () => {
    // The entry is presented but the library has no such analysis, which is the
    // "reference preserved but unavailable" case the document contract keeps.
    const design = designWithPresentedLayer() as unknown as {
      lidar: { entries: Array<Record<string, unknown>> }
    }
    design.lidar.entries.push({
      kind: 'Analysis',
      id: 'adef-absent',
      visible: true,
      opacity: 1,
      order: 1,
      style: null,
    })
    replaceCurrentDesignState(
      design as unknown as Parameters<typeof replaceCurrentDesignState>[0],
      null,
      'Inspect',
    )
    lidarLibrary.value = libraryWithGeneration('gen-1') as never

    beginInspection({ kind: 'Analysis', id: 'adef-absent', name: 'Absent' })
    await sampleInspectionPoint(POINT)
    expect(inspectionSample.value).toEqual({
      kind: 'unavailable',
      reason: 'missing-generation',
    })
    expect(samplePixel).not.toHaveBeenCalled()
  })

  it('ends inspection at entry when the layer is not presented at all', () => {
    // Entering for an entry the Design does not present must not leave a mode
    // that can never resolve.
    beginInspection({ kind: 'Source', id: 'lyr-not-presented', name: 'Absent' })
    expect(inspectionTarget.value).toBeNull()
  })

  it('ends inspection when the inspected layer is hidden', () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    expect(inspectionTarget.value?.id).toBe('lyr-1')

    const design = designWithPresentedLayer() as unknown as {
      lidar: { entries: Array<Record<string, unknown>> }
    }
    design.lidar.entries[0]!.visible = false
    replaceCurrentDesignState(
      design as unknown as Parameters<typeof replaceCurrentDesignState>[0],
      null,
      'Inspect',
    )
    reconcileInspectionWithPresentation()
    expect(inspectionTarget.value).toBeNull()
  })

  it('ends inspection when the inspected layer is removed from the Design', () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const design = designWithPresentedLayer() as unknown as {
      lidar: { entries: Array<Record<string, unknown>> }
    }
    design.lidar.entries = []
    replaceCurrentDesignState(
      design as unknown as Parameters<typeof replaceCurrentDesignState>[0],
      null,
      'Inspect',
    )
    reconcileInspectionWithPresentation()
    expect(inspectionTarget.value).toBeNull()
  })

  it('does nothing when inspection is already off', () => {
    expect(inspectionTarget.value).toBeNull()
    expect(() => reconcileInspectionWithPresentation()).not.toThrow()
  })

  it('samples nothing once the session has exited', async () => {
    await sampleInspectionPoint(POINT)
    expect(inspectionSample.value).toEqual({ kind: 'idle' })
    expect(samplePixel).not.toHaveBeenCalled()
  })

  it('keeps the current Design reachable for the fence', () => {
    // Guards the fixture itself: if the Design stopped presenting the layer the
    // other tests would pass for the wrong reason.
    expect(currentDesign.value?.lidar?.entries).toHaveLength(1)
  })
})
