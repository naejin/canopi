import { effect } from '@preact/signals'
import { sceneEntityRevision } from './canvas'
import { currentDesign } from './design'
import { currentCanvasSession } from '../canvas/session'
import { mutateCurrentDesign } from './document-mutations'
import { STRATA_ROWS } from '../canvas/consortium-renderer'

const DEFAULT_STRATUM: string = STRATA_ROWS[STRATA_ROWS.length - 1]!

let _disposer: (() => void) | null = null

export function installConsortiumSync(): void {
  _disposer?.()

  _disposer = effect(() => {
    void sceneEntityRevision.value
    const d = currentDesign.value // subscribe so document replacement re-triggers
    if (!d) return

    const s = currentCanvasSession.peek()
    if (!s) return
    const currentPlants = s.getPlacedPlants()
    const currentConsortiums = d.consortiums
    const currentNames = new Set<string>()
    for (const p of currentPlants) currentNames.add(p.canonical_name)

    const existingConsortiumNames = new Set<string>()
    for (const c of currentConsortiums) existingConsortiumNames.add(c.canonical_name)
    const toAdd: string[] = []
    for (const name of currentNames) {
      if (!existingConsortiumNames.has(name)) {
        toAdd.push(name)
      }
    }

    // Additive only: consortium entries are user-authored document metadata.
    // Deleting them here would make canvas undo restore plants without restoring
    // the user's stratum/phase edits. The chart filters inactive entries at
    // render time, so preserved entries do not appear for absent species.
    if (toAdd.length === 0) return

    mutateCurrentDesign((design) => {
      const newEntries = toAdd.map((name) => ({ canonical_name: name, stratum: DEFAULT_STRATUM, start_phase: 0, end_phase: 2 }))
      const consortiums = [...design.consortiums, ...newEntries]
      return { ...design, consortiums }
    }, { markDirty: false })
  })
}

export function disposeConsortiumSync(): void {
  _disposer?.()
  _disposer = null
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => { disposeConsortiumSync() })
}
