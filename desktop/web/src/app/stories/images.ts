import {
  STORY_IMAGE_DATA_TYPES,
  STORY_IMAGE_MAX_BYTES,
  STORY_IMAGES_MAX_TOTAL_BYTES,
} from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'

// Story images are embedded in the Design as base64 `data:` URIs (decision D1):
// PNG, JPEG, WebP or GIF, at most 1 MiB each and 10 MiB per Design, the same
// limits the file admission checks (views-admission.ts).

export type StoryImageProblem = 'type' | 'tooLarge' | 'designFull' | 'unreadable'

export type StoryImageRead =
  | { readonly ok: true; readonly src: string; readonly bytes: number }
  | { readonly ok: false; readonly problem: StoryImageProblem; readonly bytes: number }

/** The file types an image picker offers. */
export const STORY_IMAGE_ACCEPT = STORY_IMAGE_DATA_TYPES.join(',')

/** Decoded bytes of every image a Design embeds. */
export function designEmbeddedImageBytes(design: Pick<CanopiFile, 'stories'> | null): number {
  let bytes = 0
  for (const story of design?.stories ?? []) {
    for (const step of story.steps) {
      for (const image of step.images ?? []) bytes += embeddedBytes(image.src)
    }
  }
  return bytes
}

/**
 * Reads a chosen image file as a data URI when the Design can hold it: a
 * supported type, at most 1 MiB, and within the Design's 10 MiB of images.
 */
export async function readStoryImageFile(
  file: Pick<File, 'type' | 'size'> & Blob,
  design: Pick<CanopiFile, 'stories'> | null,
): Promise<StoryImageRead> {
  const bytes = file.size
  if (!(STORY_IMAGE_DATA_TYPES as readonly string[]).includes(file.type)) return { ok: false, problem: 'type', bytes }
  if (bytes > STORY_IMAGE_MAX_BYTES) return { ok: false, problem: 'tooLarge', bytes }
  if (designEmbeddedImageBytes(design) + bytes > STORY_IMAGES_MAX_TOTAL_BYTES) return { ok: false, problem: 'designFull', bytes }
  try {
    const src = await readAsDataUrl(file)
    const prefix = `data:${file.type};base64,`
    if (!src.startsWith(prefix) || embeddedBytes(src) !== bytes) return { ok: false, problem: 'unreadable', bytes }
    return { ok: true, src, bytes }
  } catch {
    return { ok: false, problem: 'unreadable', bytes }
  }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable'))
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}

/** Decoded bytes of a base64 data URI; 0 for a link. */
function embeddedBytes(src: string): number {
  const marker = src.indexOf(';base64,')
  if (!src.startsWith('data:') || marker === -1) return 0
  const payload = src.slice(marker + ';base64,'.length)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor(payload.length / 4) * 3 - padding
}

/** An image size for people: "1.4 MB" in the interface language. */
export function formatImageBytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 })
    .format(Math.max(0.1, bytes / (1024 * 1024)))
}
