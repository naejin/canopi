import { effect } from '@preact/signals'
import { sceneEntityRevision } from './canvas'
import { currentDesign } from './design'
import { currentCanvasSession } from '../canvas/session'
import { upsertConsortiumEntry, deleteConsortiumEntry } from './consortium-actions'

export function installConsortiumSync(): () => void {
  let lastSyncedNames = new Set<string>()

  return effect(() => {
    void sceneEntityRevision.value
    const d = currentDesign.peek()
    if (!d) return

    const s = currentCanvasSession.peek()
    const currentPlants = s?.getPlacedPlants() ?? d.plants ?? []
    const currentConsortiums = d.consortiums ?? []
    const currentNames = new Set(currentPlants.map((p) => p.canonical_name))

    if (currentNames.size === lastSyncedNames.size) {
      let same = true
      for (const name of currentNames) {
        if (!lastSyncedNames.has(name)) { same = false; break }
      }
      if (same) return
    }

    for (const name of currentNames) {
      if (!lastSyncedNames.has(name) && !currentConsortiums.some((c) => c.canonical_name === name)) {
        upsertConsortiumEntry({
          canonical_name: name,
          stratum: 'unassigned',
          start_phase: 0,
          end_phase: 2,
        }, { markDirty: false })
      }
    }

    const consortiumNames = new Set(currentConsortiums.map((c) => c.canonical_name))
    for (const name of consortiumNames) {
      if (!currentNames.has(name)) {
        deleteConsortiumEntry(name, { markDirty: false })
      }
    }

    lastSyncedNames = currentNames
  })
}
