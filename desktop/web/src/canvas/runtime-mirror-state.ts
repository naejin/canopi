import { signal } from '@preact/signals'

// Lock state — nodes in this set cannot be selected or transformed.
export const lockedObjectIds = signal<Set<string>>(new Set())

// Incremented on scene mutations so non-runtime UI can subscribe to canvas changes.
export const sceneEntityRevision = signal<number>(0)

// Incremented when localized plant names finish loading into the presentation cache.
export const plantNamesRevision = signal<number>(0)
