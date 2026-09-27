import type { SavedView, StoryStep } from '../../types/design'
import { editCurrentDesign } from './core'

// Saved views are Design Edit data (ADR 0011): every command dirties the Design
// for continuous save, none is in the scene history, and a command that changes
// nothing returns the Design untouched. Stories are admitted and saved with the
// Design; their commands come with the Stories panel.

/** What deleting a view removed, so Undo can put it back where it was. */
export interface SavedViewDeletion {
  readonly view: SavedView
  readonly index: number
  /** Story steps that showed the view, in story order, with their positions. */
  readonly steps: readonly { readonly storyId: string; readonly step: StoryStep; readonly index: number }[]
}

export function addSavedView(view: SavedView): void {
  editCurrentDesign((design) => {
    const views = design.views ?? []
    if (views.some((existing) => existing.id === view.id)) return design
    return { ...design, views: [...views, view] }
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
    deletion = { view: views[index]!, index, steps: removedSteps }
    return {
      ...design,
      views: views.filter((view) => view.id !== id),
      stories: removedSteps.length === 0 ? stories : nextStories,
    }
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
    return { ...design, views: nextViews, stories: nextStories }
  })
}
