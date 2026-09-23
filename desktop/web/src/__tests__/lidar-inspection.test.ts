import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LidarSampleOutcome } from '../generated/contracts'

/** Deferred native answers, so a test can control when a lookup settles. */
const pending: Array<(outcome: LidarSampleOutcome) => void> = []
const samplePixel = vi.fn(
  (_request: unknown) =>
    new Promise<LidarSampleOutcome>((resolve) => {
      pending.push(resolve)
    }),
)

const cancelSample = vi.fn(async (_requestId: string) => {})

vi.mock('../ipc/lidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc/lidar')>()
  return {
    ...actual,
    lidarSamplePixel: (request: unknown) => samplePixel(request),
    lidarCancelSamplePixel: (requestId: string) => cancelSample(requestId),
  }
})

const { currentDesign, replaceCurrentDesignState } = await import(
  '../app/document-session/store'
)
const { lidarLibrary } = await import('../app/lidar/library-store')
const {
  beginInspection,
  endInspection,
  hasInspectionPointerHandler,
  inspectionLocation,
  inspectionSample,
  inspectionTarget,
  interpretOutcome,
  reconcileInspectionWithPresentation,
  sampleInspectionCentre,
  sampleInspectionPoint,
} = await import('../app/lidar/inspection')
const { setCurrentCanvasSession } = await import('../canvas/session')
const { createTestCanvasRuntimeSurfaces } = await import('./support/canvas-runtime-surfaces')

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

/** One WGS84 point, as the canvas's own `worldToGeo` would report it. */
const POINT = { lat: 48.4312, lon: 0.0911 }

describe('numeric inspection session state', () => {
  beforeEach(() => {
    pending.length = 0
    samplePixel.mockClear()
    cancelSample.mockClear()
    endInspection()
    setCurrentCanvasSession(null)
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

  it('publishes a sampled value for the point the canvas displayed', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const sampling = sampleInspectionPoint(POINT)
    expect(inspectionSample.value).toEqual({ kind: 'loading' })

    pending[0]?.({ Value: { generation_id: 'gen-1', value: 42.25, units: 'm' } })
    await sampling

    expect(inspectionSample.value).toEqual({ kind: 'value', value: 42.25, units: 'm' })
    // The native side receives the sampled WGS84 point itself, the expected
    // generation and no offset of any kind.
    expect(samplePixel).toHaveBeenCalledTimes(1)
    expect(samplePixel.mock.calls[0]?.[0]).toEqual({
      kind: 'Source',
      entity_id: 'lyr-1',
      expected_generation_id: 'gen-1',
      // Every lookup names itself so it can be cancelled.
      request_id: expect.any(String),
      longitude: POINT.lon,
      latitude: POINT.lat,
    })
  })

  it('never publishes a superseded answer as the current sample', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const first = sampleInspectionPoint(POINT)
    const second = sampleInspectionPoint({ ...POINT, lon: POINT.lon + 0.001 })

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

  /**
   * The head can move while an answer is in flight.
   *
   * The native side checks currency before it reads, so this window is the one
   * after that check: without a second check here the old head's number would be
   * published as the current layer's value.
   */
  /**
   * A superseded lookup is cancelled, not merely ignored.
   *
   * The native read is admitted into the shared bounded display queue, so a
   * superseded or exited lookup that is only fenced in the frontend still holds
   * a slot and still does work. This pins the signal that releases it, and that
   * the id it names is the one the cancelled request carried.
   */
  it('cancels the superseded lookup by the id it was submitted under', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const first = sampleInspectionPoint(POINT)
    const firstId = (samplePixel.mock.calls[0]?.[0] as { request_id: string }).request_id
    expect(firstId).toBeTruthy()

    const second = sampleInspectionPoint({ ...POINT, lon: POINT.lon + 0.001 })
    const secondId = (samplePixel.mock.calls[1]?.[0] as { request_id: string }).request_id
    // Every lookup names its own opaque id, so cancelling one cannot signal the
    // other.
    expect(secondId).not.toBe(firstId)
    expect(cancelSample).toHaveBeenCalledWith(firstId)

    pending[1]?.({ Value: { generation_id: 'gen-1', value: 7, units: 'm' } })
    await second
    pending[0]?.({ Value: { generation_id: 'gen-1', value: 999, units: 'm' } })
    await first
    expect(inspectionSample.value).toEqual({ kind: 'value', value: 7, units: 'm' })

    // Exiting cancels whatever is still in flight, and does nothing once the
    // answer already arrived.
    const third = sampleInspectionPoint(POINT)
    const thirdId = (samplePixel.mock.calls[2]?.[0] as { request_id: string }).request_id
    endInspection()
    expect(cancelSample).toHaveBeenCalledWith(thirdId)
    cancelSample.mockClear()
    pending[2]?.({ Value: { generation_id: 'gen-1', value: 1, units: 'm' } })
    await third
    endInspection()
    expect(cancelSample).not.toHaveBeenCalled()
  })

  it('does not publish an answer whose head moved while it was in flight', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const reading = sampleInspectionPoint(POINT)
    // The layer published a new head after this lookup was aimed.
    lidarLibrary.value = libraryWithGeneration('gen-2') as never
    pending[0]?.({ Value: { generation_id: 'gen-1', value: 123.5, units: 'm' } })
    await reading
    expect(inspectionSample.value.kind).not.toBe('value')
    expect(inspectionSample.value).toEqual({ kind: 'stale' })
  })

  /**
   * A Design replacement is a different document, not an edit of this one.
   *
   * The session names the Design it was entered for, so the replacement ends it
   * — including when the replacement drops the inspected entry, which is the
   * case that leaves a stale target behind if only the presentation is consulted
   * at aim time.
   */
  it('releases inspection when the Design is replaced', async () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const reading = sampleInspectionPoint(POINT)
    const next = designWithPresentedLayer() as unknown as {
      lidar: { entries: Array<Record<string, unknown>> }
    }
    next.lidar.entries = []
    replaceCurrentDesignState(
      next as unknown as Parameters<typeof replaceCurrentDesignState>[0],
      null,
      'Another Design',
    )
    pending[0]?.({ Value: { generation_id: 'gen-1', value: 123.5, units: 'm' } })
    await reading
    expect(inspectionTarget.value).toBeNull()
    expect(inspectionSample.value.kind).not.toBe('value')
    // The replaced session also releases the canvas gesture it installed.
    expect(hasInspectionPointerHandler()).toBe(false)
  })

  it('releases the canvas gesture when inspection ends or is reconciled away', () => {
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    expect(hasInspectionPointerHandler()).toBe(true)
    endInspection()
    expect(hasInspectionPointerHandler()).toBe(false)

    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    expect(hasInspectionPointerHandler()).toBe(true)

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
    expect(hasInspectionPointerHandler()).toBe(false)
  })

  /**
   * The keyboard sampling path and the pointer path are one command.
   *
   * The centre button is the only way to read a value without a pointer, so it
   * must go through the same session and the same native request rather than a
   * second call path.
   */
  it('samples the viewport centre through the same command as a click', async () => {
    // The centre button reads the live viewport through the existing canvas
    // query surface, so the test provides one rather than a second camera owner.
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces())
    beginInspection({ kind: 'Source', id: 'lyr-1', name: 'Ground' })
    const submitted = sampleInspectionCentre()
    expect(submitted).toBe(true)
    expect(samplePixel).toHaveBeenCalledTimes(1)
    const request = samplePixel.mock.calls[0]?.[0] as {
      longitude: number
      latitude: number
      expected_generation_id: string
    }
    expect(request.expected_generation_id).toBe('gen-1')
    expect(Number.isFinite(request.longitude)).toBe(true)
    expect(Number.isFinite(request.latitude)).toBe(true)
    // The displayed coordinate is the sampled point, not an anchor.
    expect(inspectionLocation.value).toEqual({
      lat: request.latitude,
      lon: request.longitude,
    })
    pending[0]?.({ Value: { generation_id: 'gen-1', value: 3, units: 'm' } })
    await Promise.resolve()
  })

  it('submits no sample at the view centre when nothing is inspected', () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces())
    expect(sampleInspectionCentre()).toBe(false)
    expect(samplePixel).not.toHaveBeenCalled()
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
