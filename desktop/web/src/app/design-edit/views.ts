import type { CanopiFile, SavedView, StoryStep } from '../../types/design'
import { PLANT_LABEL_MODES, type PlantLabelMode } from '../../canvas/runtime/plant-display'
import { editCurrentDesign, readCurrentDesign } from './core'
import { DESIGN_EDIT_EXTRA_KEYS, readExtra, reportExtraRepair, withExtra } from './extra-keys'
import { editWithinImageLimit, parkStepsAwaitingView, takeStepsAwaitingView, type StoryEditOutcome } from './stories'

// Saved views are Design Edit data (ADR 0011): every command dirties the Design
// for continuous save, none is in the scene history, and a command that changes
// nothing returns the Design untouched. Story commands live in stories.ts.

/**
 * How each saved view shows the Design's plants, by view id, as the Design
 * stores it in `extra.saved_view_display` (a root key the format keeps as
 * unknown `extra`, like `plant_display`): `{ "<view id>": { "labels": "codes" } }`.
 * A saved view has no field for it, and the format stays as it is. Every write
 * prunes entries whose view is gone.
 */
const SAVED_VIEW_DISPLAY_EXTRA_KEY = DESIGN_EDIT_EXTRA_KEYS.savedViewDisplay

export interface SavedViewDisplay {
  readonly labels: PlantLabelMode
}

/** The labels recorded with a view, or null for a view saved without them. */
export function savedViewPlantLabels(design: Pick<CanopiFile, 'extra'> | null, viewId: string): PlantLabelMode | null {
  return readSavedViewDisplay(design, viewId)?.labels ?? null
}

function readSavedViewDisplay(design: Pick<CanopiFile, 'extra'> | null, viewId: string): SavedViewDisplay | null {
  const entry = readExtra(design, SAVED_VIEW_DISPLAY_EXTRA_KEY)?.[viewId]
  if (entry === undefined) return null
  const labels = entry && typeof entry === 'object' ? (entry as { labels?: unknown }).labels : undefined
  if (!PLANT_LABEL_MODES.includes(labels as PlantLabelMode)) {
    reportExtraRepair(design, SAVED_VIEW_DISPLAY_EXTRA_KEY, `view ${viewId} has no valid labels`)
    return null
  }
  return { labels: labels as PlantLabelMode }
}

/**
 * The Design with `viewId`'s display set, or removed with null. Entries whose
 * view is gone are pruned on the way; the key goes when nothing is left.
 */
function withSavedViewDisplay(design: CanopiFile, viewId: string, display: SavedViewDisplay | null): CanopiFile {
  const viewIds = new Set((design.views ?? []).map((view) => view.id))
  const all: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(readExtra(design, SAVED_VIEW_DISPLAY_EXTRA_KEY) ?? {})) {
    if (id !== viewId && viewIds.has(id)) all[id] = entry
  }
  if (display && viewIds.has(viewId)) all[viewId] = { labels: display.labels }
  return withExtra(design, SAVED_VIEW_DISPLAY_EXTRA_KEY, Object.keys(all).length === 0 ? null : all)
}

/** What deleting a view removed, so Undo can put it back where it was. */
export interface SavedViewDeletion {
  readonly view: SavedView
  /** How the view showed plants, if recorded. */
  readonly display: SavedViewDisplay | null
  readonly index: number
  /** Story steps that showed the view, in story order, with their positions. */
  readonly steps: readonly { readonly storyId: string; readonly step: StoryStep; readonly index: number }[]
}

/** Adds a view, with how it shows plants when given, as one edit. */
export function addSavedView(view: SavedView, display: SavedViewDisplay | null = null): void {
  editCurrentDesign((design) => {
    const views = design.views ?? []
    if (views.some((existing) => existing.id === view.id)) return design
    const added = { ...design, views: [...views, view] }
    return display ? withSavedViewDisplay(added, view.id, display) : added
  })
}

/**
 * Points an existing view at what the map shows now: camera, extent, layers,
 * highlights and labels. Its name, title and text stay. Every step that shows
 * the view shows the new capture.
 */
export function recaptureSavedView(id: string, capture: SavedView, display: SavedViewDisplay | null = null): void {
  editCurrentDesign((design) => {
    const views = design.views ?? []
    const index = views.findIndex((view) => view.id === id)
    if (index === -1) return design
    const current = views[index]!
    const next: SavedView = {
      ...current,
      camera: capture.camera,
      visible_layers: capture.visible_layers,
      highlighted: capture.highlighted,
    }
    if (capture.extent) next.extent = capture.extent
    else delete next.extent
    const sameCapture = JSON.stringify(next) === JSON.stringify(current)
    const sameDisplay = display === null || readSavedViewDisplay(design, id)?.labels === display.labels
    if (sameCapture && sameDisplay) return design
    const nextViews = [...views]
    nextViews[index] = next
    const recaptured = { ...design, views: nextViews }
    return display ? withSavedViewDisplay(recaptured, id, display) : recaptured
  })
}

export function renameSavedView(id: string, name: string): void {
  const nextName = name.trim()
  if (nextName.length === 0) return
  editCurrentDesign((design) => {
    const views = design.views ?? []
    const index = views.findIndex((view) => view.id === id)
    if (index === -1 || views[index]!.name === nextName) return design
    const next = [...views]
    next[index] = { ...views[index]!, name: nextName }
    return { ...design, views: next }
  })
}

/**
 * Deletes a view and every story step that shows it, so no step dangles.
 * Callers confirm first when stories use the view. Returns what was removed.
 */
export function deleteSavedView(id: string): SavedViewDeletion | null {
  let deletion: SavedViewDeletion | null = null
  editCurrentDesign((design) => {
    const views = design.views ?? []
    const index = views.findIndex((view) => view.id === id)
    if (index === -1) return design
    const removedSteps: SavedViewDeletion['steps'][number][] = []
    const stories = design.stories ?? []
    const nextStories = stories.map((story) => {
      const steps = story.steps.filter((step, stepIndex) => {
        if (step.view_id !== id) return true
        removedSteps.push({ storyId: story.id, step, index: stepIndex })
        return false
      })
      return steps.length === story.steps.length ? story : { ...story, steps }
    })
    deletion = { view: views[index]!, display: readSavedViewDisplay(design, id), index, steps: removedSteps }
    return withSavedViewDisplay({
      ...design,
      views: views.filter((view) => view.id !== id),
      stories: removedSteps.length === 0 ? stories : nextStories,
    }, id, null)
  })
  return deletion
}

/**
 * Undo for `deleteSavedView`: puts the view and its steps back at their
 * positions, with any step a story or step Undo had parked while the view was
 * gone. Steps whose story is gone stay deleted; a view that exists again is
 * left alone.
 */
export function restoreSavedView(deletion: SavedViewDeletion): StoryEditOutcome {
  const current = readCurrentDesign()
  if (!current || (current.views ?? []).some((view) => view.id === deletion.view.id)) return 'unchanged'
  const parked = takeStepsAwaitingView(deletion.view.id)
  const restoredSteps = [...deletion.steps, ...parked]
  const outcome = editWithinImageLimit((design) => {
    const views = design.views ?? []
    if (views.some((view) => view.id === deletion.view.id)) return design
    const nextViews = [...views]
    nextViews.splice(Math.min(deletion.index, views.length), 0, deletion.view)
    const stories = design.stories ?? []
    const nextStories = stories.map((story) => {
      const removed = restoredSteps.filter((entry) => entry.storyId === story.id)
      if (removed.length === 0) return story
      const steps = [...story.steps]
      for (const entry of removed) {
        if (steps.some((step) => step.id === entry.step.id)) continue
        steps.splice(Math.min(entry.index, steps.length), 0, entry.step)
      }
      return { ...story, steps }
    })
    const restored = { ...design, views: nextViews, stories: nextStories }
    return deletion.display ? withSavedViewDisplay(restored, deletion.view.id, deletion.display) : restored
  })
  if (outcome !== 'applied') parkStepsAwaitingView(parked)
  return outcome
}
