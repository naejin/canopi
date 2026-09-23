import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R50 boundary: UI → real action → authored IPC wrapper.
 * Only the Tauri transport is mocked; `ipc/lidar.ts` and `app/lidar/actions.ts`
 * are real. Two failed definitions with different IDs, names and parameters;
 * Create fields change; retry the second row by name.
 */
const invoke = vi.hoisted(() => vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => null))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const upsert = vi.hoisted(() => vi.fn())
vi.mock('../app/design-edit/lidar', () => ({
  upsertLidarEntry: upsert,
  patchLidarEntryById: vi.fn(),
  removeLidarEntries: vi.fn(),
  moveLidarEntry: vi.fn(),
}))

const identity = vi.hoisted(() => ({ value: { id: 'design-a' } as object }))
vi.mock('../app/document-session/store', () => ({
  designSessionStore: { sessionIdentity: identity },
}))

const library = vi.hoisted(() => ({
  value: {
    layers: [] as unknown[],
    analyses: [] as unknown[],
    engine: { available: true, version: null, detail: null },
  },
}))

// Real library-store is required for job tracking; only its IPC-backed read is
// satisfied through the same mocked transport.
vi.mock('../ipc/lidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc/lidar')>()
  return actual
})

import { AnalysisPanel } from '../components/panels/lidar/AnalysisPanel'
import { locale } from '../app/settings/state'

function layer() {
  return {
    id: 'lyr-1',
    name: 'Ground',
    measurement_kind: 'GroundElevation' as const,
    units: 'm',
    state: 'Ready' as const,
    coverage_cells: '10',
    resolution_m: 0.5,
    bounds: null,
    value_range: null,
    analysis_count: 2,
    display_range: null,
    tilesets: [
      {
        style: 'elevation',
        source: { kind: 'native-generation', generation_id: 'gen-1' },
        min_zoom: 0,
        max_zoom: 1,
        tile_size: 256,
        bounds: null,
      },
    ],
  }
}

const alpha = {
  id: 'adef-alpha',
  source_layer_id: 'lyr-1',
  kind: 'Slope',
  name: 'North slope',
  state: 'Failed' as const,
  detail: 'a',
  bounds: null,
  value_range: null,
  slope_unit: 'Degrees' as const,
  tilesets: [],
}
const beta = {
  id: 'adef-beta',
  source_layer_id: 'lyr-1',
  kind: 'Slope',
  name: 'South slope',
  state: 'Failed' as const,
  detail: 'b',
  bounds: null,
  value_range: null,
  slope_unit: 'Percent' as const,
  tilesets: [],
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('R50 UI → action → authored IPC wrapper', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    invoke.mockClear()
    upsert.mockClear()
    identity.value = { id: 'design-a' }
    library.value = {
      layers: [layer()],
      analyses: [alpha, beta],
      engine: { available: true, version: null, detail: null },
    }
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const a = (args ?? {}) as Record<string, unknown>
      if (cmd === 'lidar_list_library') return library.value
      if (cmd === 'lidar_retry_analysis') {
        return {
          definition_id: a.definitionId,
          job_id: `job-${a.definitionId}`,
        }
      }
      return null
    })
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('retries the row identified by name with its saved definition id and expected generation', async () => {
    // Real library-store must see the fixture; drive it through the real module.
    const store = await import('../app/lidar/library-store')
    store.lidarLibrary.value = library.value as never

    act(() => {
      render(<AnalysisPanel />, container)
    })
    const input = container.querySelector<HTMLInputElement>('input[name="analysis-input"]')
    act(() => {
      input?.click()
    })

    // Change Create form fields: they must not leak into the retry command.
    const nameField = container.querySelector<HTMLInputElement>('input[type="text"]')
    act(() => {
      if (nameField) {
        nameField.value = 'Create form name'
        nameField.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    const rows = Array.from(container.querySelectorAll('li'))
    const southRow = rows.find((row) => (row.textContent ?? '').includes('South slope'))
    expect(southRow).toBeDefined()
    const retry = Array.from(southRow?.querySelectorAll('button') ?? []).find((button) =>
      (button.textContent ?? '').includes('Retry analysis'),
    )
    expect(retry).toBeDefined()

    act(() => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    // Authored IPC wrapper receives the second saved definition ID and expected generation.
    expect(invoke).toHaveBeenCalledWith('lidar_retry_analysis', {
      definitionId: 'adef-beta',
      expectedSourceGenerationId: 'gen-1',
    })
    // No create command is sent for a retry.
    expect(
      invoke.mock.calls.filter((call) => call[0] === 'lidar_create_analysis'),
    ).toHaveLength(0)
    // Returned identity drives the right presentation.
    expect(upsert).toHaveBeenCalledWith('Analysis', 'adef-beta')
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
