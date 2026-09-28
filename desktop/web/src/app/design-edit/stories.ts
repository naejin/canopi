import type { CanopiFile, RichTextBlock, Story, StoryImage, StoryStep } from '../../types/design'
import { currentDesignSessionKey, editCurrentDesign, readCurrentDesign } from './core'

// Stories are Design Edit data (ADR 0011), like saved views: every command
// dirties the Design for continuous save, none is in the scene history, and a
// command that changes nothing returns the Design untouched. A step shows a
// saved view of the same Design by id; callers pass only ids of views that
// exist, and deleting a view (views.ts) removes the steps that show it. An
// Undo that meets a missing view parks its steps until that view's own Undo.

/** What deleting a story removed, so Undo can put it back where it was. */
interface StoryDeletion {
  readonly story: Story
  readonly index: number
}

/** What deleting a step removed, so Undo can put it back where it was. */
interface StoryStepDeletion {
  readonly storyId: string
  readonly step: StoryStep
  readonly index: number
}

/** The fields of a step an editor changes. */
type StoryStepPatch = Partial<Pick<StoryStep, 'title' | 'text' | 'images' | 'view_id'>>

/**
 * Steps an Undo could not put back because their view had been deleted in
 * between, by view id, for the Design session that dropped them. Undoing the
 * view's deletion (`restoreSavedView`) puts them back where they were; another
 * Design forgets them with its session.
 */
const parkedSteps = new WeakMap<object, Map<string, StoryStepDeletion[]>>()

function parkStepsAwaitingView(entries: readonly StoryStepDeletion[]): void {
  if (entries.length === 0) return
  const key = currentDesignSessionKey()
  let byView = parkedSteps.get(key)
  if (!byView) parkedSteps.set(key, byView = new Map())
  for (const entry of entries) {
    const list = byView.get(entry.step.view_id) ?? []
    list.push(entry)
    byView.set(entry.step.view_id, list)
  }
}

/** Takes the steps parked for `viewId`, in the order they were dropped; views.ts restores them with the view. */
export function takeStepsAwaitingView(viewId: string): readonly StoryStepDeletion[] {
  const byView = parkedSteps.get(currentDesignSessionKey())
  const entries = byView?.get(viewId) ?? []
  byView?.delete(viewId)
  return entries
}

function viewExists(design: CanopiFile, viewId: string): boolean {
  return (design.views ?? []).some((view) => view.id === viewId)
}

function editStories(update: (stories: readonly Story[], design: CanopiFile) => readonly Story[]): void {
  editCurrentDesign((design) => {
    const stories = design.stories ?? []
    const next = update(stories, design)
    return next === stories ? design : { ...design, stories: [...next] }
  })
}

function editStory(storyId: string, update: (story: Story) => Story): void {
  editStories((stories) => {
    const index = stories.findIndex((story) => story.id === storyId)
    if (index === -1) return stories
    const next = update(stories[index]!)
    if (next === stories[index]) return stories
    const copy = [...stories]
    copy[index] = next
    return copy
  })
}

export function addStory(story: Story): void {
  editStories((stories) => stories.some((existing) => existing.id === story.id) ? stories : [...stories, story])
}

/** Renames a story; a blank name keeps the old one. */
export function renameStory(storyId: string, name: string): void {
  const nextName = name.trim()
  if (nextName.length === 0) return
  editStory(storyId, (story) => story.name === nextName ? story : { ...story, name: nextName })
}

export function deleteStory(storyId: string): StoryDeletion | null {
  let deletion: StoryDeletion | null = null
  editStories((stories) => {
    const index = stories.findIndex((story) => story.id === storyId)
    if (index === -1) return stories
    deletion = { story: stories[index]!, index }
    return stories.filter((story) => story.id !== storyId)
  })
  return deletion
}

/**
 * Undo for `deleteStory`. Steps whose view is gone since stay out, so none
 * dangles; they are parked and return with the view's own Undo.
 */
export function restoreStory(deletion: StoryDeletion): void {
  const design = readCurrentDesign()
  if (!design || (design.stories ?? []).some((story) => story.id === deletion.story.id)) return
  const dropped = deletion.story.steps.flatMap((step, index) => (
    viewExists(design, step.view_id) ? [] : [{ storyId: deletion.story.id, step, index }]
  ))
  const kept = new Set(dropped.map((entry) => entry.step.id))
  editStories((stories) => {
    if (stories.some((story) => story.id === deletion.story.id)) return stories
    const story = { ...deletion.story, steps: deletion.story.steps.filter((step) => !kept.has(step.id)) }
    const copy = [...stories]
    copy.splice(Math.min(deletion.index, copy.length), 0, story)
    return copy
  })
  parkStepsAwaitingView(dropped)
}

/** Adds a step at `index` (the end by default) when its view exists. */
export function addStoryStep(storyId: string, step: StoryStep, index?: number): void {
  editCurrentDesign((design) => {
    if (!(design.views ?? []).some((view) => view.id === step.view_id)) return design
    const stories = design.stories ?? []
    const storyIndex = stories.findIndex((story) => story.id === storyId)
    const story = stories[storyIndex]
    if (!story || story.steps.some((existing) => existing.id === step.id)) return design
    const steps = [...story.steps]
    steps.splice(index === undefined ? steps.length : Math.max(0, Math.min(index, steps.length)), 0, step)
    const next = [...stories]
    next[storyIndex] = { ...story, steps }
    return { ...design, stories: next }
  })
}

export function updateStoryStep(storyId: string, stepId: string, patch: StoryStepPatch): void {
  editCurrentDesign((design) => {
    if (patch.view_id !== undefined && !(design.views ?? []).some((view) => view.id === patch.view_id)) return design
    const stories = design.stories ?? []
    const storyIndex = stories.findIndex((story) => story.id === storyId)
    const story = stories[storyIndex]
    const stepIndex = story?.steps.findIndex((step) => step.id === stepId) ?? -1
    if (!story || stepIndex === -1) return design
    const step = story.steps[stepIndex]!
    const changed = (Object.keys(patch) as (keyof StoryStepPatch)[])
      .some((key) => patch[key] !== undefined && !sameValue(patch[key], step[key]))
    if (!changed) return design
    const steps = [...story.steps]
    steps[stepIndex] = { ...step, ...definedFields(patch) }
    const next = [...stories]
    next[storyIndex] = { ...story, steps }
    return { ...design, stories: next }
  })
}

/** Moves a step to `toIndex` within its story. */
export function moveStoryStep(storyId: string, stepId: string, toIndex: number): void {
  editStory(storyId, (story) => {
    const from = story.steps.findIndex((step) => step.id === stepId)
    const to = Math.max(0, Math.min(toIndex, story.steps.length - 1))
    if (from === -1 || from === to) return story
    const steps = [...story.steps]
    const [step] = steps.splice(from, 1)
    steps.splice(to, 0, step!)
    return { ...story, steps }
  })
}

/** Puts a story's steps in the given order; ids that are not exactly its steps change nothing. */
export function reorderStorySteps(storyId: string, stepIds: readonly string[]): void {
  editStory(storyId, (story) => {
    if (stepIds.length !== story.steps.length) return story
    const byId = new Map(story.steps.map((step) => [step.id, step]))
    const steps = stepIds.map((id) => byId.get(id))
    if (steps.some((step) => !step) || new Set(stepIds).size !== stepIds.length) return story
    if (steps.every((step, index) => step === story.steps[index])) return story
    return { ...story, steps: steps as StoryStep[] }
  })
}

/** Moves a step to the end of another story, as one edit. */
export function moveStoryStepToStory(fromStoryId: string, stepId: string, toStoryId: string, newStepId: string): void {
  if (fromStoryId === toStoryId) return
  editStories((stories) => {
    const from = stories.findIndex((story) => story.id === fromStoryId)
    const to = stories.findIndex((story) => story.id === toStoryId)
    const step = stories[from]?.steps.find((entry) => entry.id === stepId)
    if (from === -1 || to === -1 || !step) return stories
    // Step ids are unique within a story; the moved step keeps its id when it can.
    const id = stories[to]!.steps.some((entry) => entry.id === step.id) ? newStepId : step.id
    const copy = [...stories]
    copy[from] = { ...stories[from]!, steps: stories[from]!.steps.filter((entry) => entry.id !== stepId) }
    copy[to] = { ...stories[to]!, steps: [...stories[to]!.steps, { ...step, id }] }
    return copy
  })
}

/** Copies a step right after itself under a new id; the copy shows the same view. */
export function duplicateStoryStep(storyId: string, stepId: string, newStepId: string): void {
  editStory(storyId, (story) => {
    const index = story.steps.findIndex((step) => step.id === stepId)
    if (index === -1 || story.steps.some((step) => step.id === newStepId)) return story
    const steps = [...story.steps]
    steps.splice(index + 1, 0, { ...story.steps[index]!, id: newStepId })
    return { ...story, steps }
  })
}

export function deleteStoryStep(storyId: string, stepId: string): StoryStepDeletion | null {
  let deletion: StoryStepDeletion | null = null
  editStory(storyId, (story) => {
    const index = story.steps.findIndex((step) => step.id === stepId)
    if (index === -1) return story
    deletion = { storyId, step: story.steps[index]!, index }
    return { ...story, steps: story.steps.filter((step) => step.id !== stepId) }
  })
  return deletion
}

/**
 * Undo for `deleteStoryStep`. Nothing comes back when the story is gone; a
 * step whose view is gone is parked and returns with the view's own Undo.
 */
export function restoreStoryStep(deletion: StoryStepDeletion): void {
  const design = readCurrentDesign()
  if (!design) return
  const storyExists = (design.stories ?? []).some((story) => story.id === deletion.storyId)
  if (storyExists && !viewExists(design, deletion.step.view_id)) {
    parkStepsAwaitingView([deletion])
    return
  }
  addStoryStep(deletion.storyId, deletion.step, deletion.index)
}

function definedFields(patch: StoryStepPatch): StoryStepPatch {
  const fields: { -readonly [Key in keyof StoryStepPatch]: StoryStepPatch[Key] } = {}
  if (patch.title !== undefined) fields.title = patch.title
  if (patch.text !== undefined) fields.text = patch.text as RichTextBlock[]
  if (patch.images !== undefined) fields.images = patch.images as StoryImage[]
  if (patch.view_id !== undefined) fields.view_id = patch.view_id
  return fields
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
