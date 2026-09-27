import type { CanopiFile, SavedView, StoryStep } from '../../types/design'
import { PLANT_LABEL_MODES, type PlantLabelMode } from '../../canvas/runtime/plant-display'
import { editCurrentDesign } from './core'

// Saved views are Design Edit data (ADR 0011): every command dirties the Design
// for continuous save, none is in the scene history, and a command that changes
// nothing returns the Design untouched. Story commands live in stories.ts.

/**
 * How each saved view shows the Design's plants, by view id, as the Design
 * stores it in `extra.saved_view_display` (a root key the format keeps as
 * unknown `extra`, like `plant_display`): `{ "<view id>": { "labels": "codes" } }`.
 * A saved view has no field for it, and the format stays as it is.
 */
export const SAVED_VIEW_DISPLAY_EXTRA_KEY = 'saved_view_display'

export interface SavedViewDisplay {
  readonly labels: PlantLabelMode
}

/** The labels recorded with a view, or null for a view saved without them. */
export function savedViewPlantLabels(design: Pick<CanopiFile, 'extra'> | null, viewId: string): PlantLabelMode | null {
  return readSavedViewDisplay(design, viewId)?.labels ?? null
}

function readSavedViewDisplay(design: Pick<CanopiFile, 'extra'> | null, viewId: string): SavedViewDisplay | null {
  const all = design?.extra?.[SAVED_VIEW_DISPLAY_EXTRA_KEY]
  if (!all || typeof all !== 'object' || Array.isArray(all)) return null
  const entry = (all as Record<string, unknown>)[viewId]
  if (!entry || typeof entry !== 'object') return null
  const labels = (entry as { labels?: unknown }).labels
  return PLANT_LABEL_MODES.includes(labels as PlantLabelMode) ? { labels: labels as PlantLabelMode } : null
}

/** The Design with `viewId`'s display set, or removed with null; the key goes when empty. */
function withSavedViewDisplay(design: CanopiFile, viewId: string, display: SavedViewDisplay | null): CanopiFile {
  const stored = design.extra?.[SAVED_VIEW_DISPLAY_EXTRA_KEY]
  const all: Record<string, unknown> = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
  if (display) all[viewId] = { labels: display.labels }
  else if (viewId in all) delete all[viewId]
  else return design
  const extra: Record<string, unknown> = { ...design.extra }
  if (Object.keys(all).length === 0) delete extra[SAVED_VIEW_DISPLAY_EXTRA_KEY]
  else extra[SAVED_VIEW_DISPLAY_EXTRA_KEY] = all
  return { ...design, extra }
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
 * positions. Steps whose story is gone stay deleted; a view that exists again
 * is left alone.
 */
export function restoreSavedView(deletion: SavedViewDeletion): void {
  editCurrentDesign((design) => {
    const views = design.views ?? []
    if (views.some((view) => view.id === deletion.view.id)) return design
    const nextViews = [...views]
    nextViews.splice(Math.min(deletion.index, views.length), 0, deletion.view)
    const stories = design.stories ?? []
    const nextStories = stories.map((story) => {
      const removed = deletion.steps.filter((entry) => entry.storyId === story.id)
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
}
