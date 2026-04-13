import { signal, type Signal } from '@preact/signals'
import { geocodeAddress } from '../../ipc/geocoding'

export interface LocationSearchResult {
  displayName: string
  lat: number
  lon: number
}

export interface LocationSearchController {
  query: Signal<string>
  results: Signal<LocationSearchResult[]>
  isSearching: Signal<boolean>
  showDropdown: Signal<boolean>
  errorKey: Signal<string>
  setQuery(next: string): void
  closeDropdown(): void
  consumeResult(): void
  dispose(): void
}

interface CreateLocationSearchControllerOptions {
  debounceMs?: number
  geocode?: (query: string) => Promise<Array<{ display_name: string; lat: number; lon: number }>>
}

export function createLocationSearchController(
  options: CreateLocationSearchControllerOptions = {},
): LocationSearchController {
  const debounceMs = options.debounceMs ?? 300
  const geocode = options.geocode ?? geocodeAddress

  const query = signal('')
  const results = signal<LocationSearchResult[]>([])
  const isSearching = signal(false)
  const showDropdown = signal(false)
  const errorKey = signal('')

  let generation = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function clearPendingRequest(): void {
    generation += 1
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function resetState(): void {
    results.value = []
    showDropdown.value = false
    isSearching.value = false
    errorKey.value = ''
  }

  function setQuery(next: string): void {
    query.value = next
    clearPendingRequest()

    const trimmed = next.trim()
    if (trimmed.length < 3) {
      resetState()
      return
    }

    const requestGeneration = generation
    isSearching.value = true
    errorKey.value = ''

    debounceTimer = setTimeout(async () => {
      debounceTimer = null
      try {
        const geocodeResults = await geocode(trimmed)
        if (disposed || requestGeneration !== generation) return

        results.value = geocodeResults.map((result) => ({
          displayName: result.display_name,
          lat: result.lat,
          lon: result.lon,
        }))
        showDropdown.value = true
        isSearching.value = false
      } catch {
        if (disposed || requestGeneration !== generation) return

        results.value = []
        showDropdown.value = true
        isSearching.value = false
        errorKey.value = 'canvas.location.geocodeError'
      }
    }, debounceMs)
  }

  function closeDropdown(): void {
    clearPendingRequest()
    showDropdown.value = false
    isSearching.value = false
  }

  function consumeResult(): void {
    query.value = ''
    resetState()
    clearPendingRequest()
  }

  function dispose(): void {
    disposed = true
    clearPendingRequest()
    isSearching.value = false
  }

  return {
    query,
    results,
    isSearching,
    showDropdown,
    errorKey,
    setQuery,
    closeDropdown,
    consumeResult,
    dispose,
  }
}
