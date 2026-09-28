/**
 * The root `extra` keys the scene runtime persists (ADR 0011 keeps them as
 * unknown `extra`). The codec reads and writes them; a document composer
 * takes these keys from the scene and every other `extra` key from the
 * Design Edit side (`app/design-edit/extra-keys.ts`).
 */
export const SCENE_GUIDES_EXTRA_KEY = 'guides'

export const SCENE_OWNED_EXTRA_KEYS: readonly string[] = Object.freeze([SCENE_GUIDES_EXTRA_KEY])
