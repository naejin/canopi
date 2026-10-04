// canvas/runtime/interaction-types.ts  (types)

import type { PlantStampSourceInput } from '../plant-stamp-source'
import type { SavedObjectStampPayload } from '../saved-object-stamp-payload'

export type PointerKind = 'mouse' | 'pen' | 'touch'
export interface Modifiers { readonly shift: boolean; readonly ctrl: boolean; readonly alt: boolean; readonly meta: boolean }
export type CancelReason = 'pointercancel' | 'lost-capture' | 'blur' | 'hidden' | 'escape' | 'multitouch' | 'tool-change'
  | 'navigate'                                                  // a Pan-tool press whose drag panned: after its pan end (spec §2.2)
export type ToolId =
  | 'select' | 'hand' | 'plant-stamp' | 'text' | 'line' | 'measurement-guide' | 'rectangle' | 'ellipse'
  | 'polygon' | 'object-stamp' | 'saved-object-stamp' | 'plant-spacing'
// 'hand' is the Pan tool (label "Pan", key H). It stays in every phase (user).
/** 'rotate', 'vertex:<zone id>:<index>', 'rect-corner:<id>:ne', 'guide-end:<id>:a', 'edge-mid:<zone id>:<index>'. */
export type ToolHandleId = string & { readonly __toolHandleId: true }
/** What a panel drag carries, read from dataTransfer by the DOM source (today plant-stamp-source.ts and saved-object-stamp-source.ts). */
export type CanvasDropPayload =
  | { readonly kind: 'species'; readonly species: PlantStampSourceInput | null }   // null on dragover: the browser hides the data until the drop; the MIME type says species
  | { readonly kind: 'saved-stamp'; readonly stamp: SavedObjectStampPayload }
  | { readonly kind: 'unknown' }                                // over the map but not ours: no drop cue
// PlantStampSourceInput (canvas/plant-stamp-source.ts) and SavedObjectStampPayload are type-only imports.
