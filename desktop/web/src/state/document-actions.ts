import { message } from '@tauri-apps/plugin-dialog'
import type { CanopiFile } from '../types/design'
import type { CanvasEngine } from '../canvas/engine'
import { canvasEngine } from '../canvas/engine'
import { extractExtra, toCanopi } from '../canvas/serializer'
import * as designIpc from '../ipc/design'
import { t } from '../i18n'
import {
  currentDesign,
  designDirty,
  designName,
  designPath,
  pendingDesignPath,
  pendingTemplateImport,
  markSaved,
  replaceCurrentDesignState,
  resetDirtyBaselines,
} from './design'

interface DocumentLoadOptions {
  engine?: CanvasEngine | null
  isCancelled?: () => boolean
}

type ReplacementDecision = 'proceed' | 'cancel'
export type TemplateOpenResult = 'opened' | 'queued' | 'cancelled'

/** Save to the current path (Ctrl+S). Opens Save As if no path exists yet. */
export async function saveCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) throw new Error('Canvas engine not ready')

  const content = toCanopi(engine, { name: designName.value }, currentDesign.value)

  if (designPath.value) {
    await designIpc.saveDesign(designPath.value, content)
    replaceCurrentDesignState(content, designPath.value, designName.value)
  } else {
    const path = await designIpc.saveDesignAs(content)
    replaceCurrentDesignState(content, path, nameFromPath(path))
  }

  markSaved()
}

/** Save As — always prompts for a new path (Ctrl+Shift+S). */
export async function saveAsCurrentDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const content = toCanopi(engine, { name: designName.value }, currentDesign.value)

  try {
    const path = await designIpc.saveDesignAs(content)
    replaceCurrentDesignState(content, path, nameFromPath(path))
    markSaved()
  } catch (error) {
    if (isCancelled(error)) return
    throw error
  }
}

/** Open file dialog and replace the active document through the shared guard. */
export async function openDesign(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  try {
    const { file, path } = await designIpc.openDesignDialog()
    applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, engine)
  } catch (error) {
    if (isCancelled(error)) return
    throw error
  }
}

/** Open a design from a known path (for example, recent files). */
export async function openDesignFromPath(
  path: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const engine = options.engine ?? canvasEngine
  if (!engine) {
    pendingDesignPath.value = path
    return
  }

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, engine)
}

/** Open a downloaded template as a new unsaved design through the shared guard. */
export async function openDesignAsTemplate(
  path: string,
  name: string,
  options: DocumentLoadOptions = {},
): Promise<TemplateOpenResult> {
  const engine = options.engine ?? canvasEngine
  if (!engine) {
    pendingTemplateImport.value = { path, name }
    return 'queued'
  }

  const decision = await confirmReplacement()
  if (decision === 'cancel') return 'cancelled'

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return 'cancelled'

  applyDocumentReplacement(normalizeLoadedDocument(file), null, name, engine)
  return 'opened'
}

/** Create a new blank design through the shared replacement guard. */
export async function newDesignAction(): Promise<void> {
  const engine = canvasEngine
  if (!engine) return

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  const file = await designIpc.newDesign()
  applyDocumentReplacement(normalizeNewDocument(file), null, 'Untitled', engine)
}

/** Consume a queued document load when CanvasPanel mounts a fresh engine.
 *  Bypasses the dirty guard — queued loads happen on fresh mount before the
 *  user has interacted, so prompting to save is semantically wrong. */
export function consumeQueuedDocumentLoad(engine: CanvasEngine): () => void {
  const queuedTemplate = pendingTemplateImport.value
  if (queuedTemplate) {
    let cancelled = false
    void loadTemplateDirect(queuedTemplate.path, queuedTemplate.name, {
      engine,
      isCancelled: () => cancelled,
    }).then(() => {
      if (!cancelled && pendingTemplateImport.value?.path === queuedTemplate.path) {
        pendingTemplateImport.value = null
      }
    }).catch((error) => {
      if (cancelled) return
      pendingTemplateImport.value = queuedTemplate
      console.error('Queued template import failed:', error)
      void message(
        `Failed to open ${queuedTemplate.name}.\n\n${formatError(error)}`,
        {
          title: 'Open failed',
          kind: 'error',
        },
      )
    })

    return () => {
      cancelled = true
    }
  }

  const queuedPath = pendingDesignPath.value
  if (!queuedPath) return () => {}

  let cancelled = false
  void loadDesignDirect(queuedPath, {
    engine,
    isCancelled: () => cancelled,
  }).then(() => {
    if (!cancelled && pendingDesignPath.value === queuedPath) {
      pendingDesignPath.value = null
    }
  }).catch((error) => {
    if (cancelled) return
    pendingDesignPath.value = queuedPath
    console.error('Queued design load failed:', error)
    void message(
      `Failed to open ${nameFromPath(queuedPath)}.\n\n${formatError(error)}`,
      {
        title: 'Open failed',
        kind: 'error',
      },
    )
  })

  return () => {
    cancelled = true
  }
}

async function confirmReplacement(): Promise<ReplacementDecision> {
  if (!designDirty.value) return 'proceed'

  const saveLabel = t('canvas.file.save')
  const discardLabel = t('canvas.file.dontSave')
  const cancelLabel = t('canvas.file.cancel')

  const result = await message(t('canvas.file.unsavedChanges'), {
    title: t('canvas.file.unsavedChanges'),
    kind: 'warning',
    buttons: {
      yes: saveLabel,
      no: discardLabel,
      cancel: cancelLabel,
    },
  })

  if (result === cancelLabel) return 'cancel'
  if (result === saveLabel) {
    try {
      await saveCurrentDesign()
    } catch (error) {
      if (isCancelled(error)) return 'cancel'
      throw error
    }
  }

  return 'proceed'
}

/** Load a design from path without the dirty guard — for queued loads on fresh mount. */
async function loadDesignDirect(
  path: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const engine = options.engine ?? canvasEngine
  if (!engine) {
    pendingDesignPath.value = path
    return
  }

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, engine)
}

async function loadTemplateDirect(
  path: string,
  name: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const engine = options.engine ?? canvasEngine
  if (!engine) {
    pendingTemplateImport.value = { path, name }
    return
  }

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), null, name, engine)
}

function applyDocumentReplacement(
  file: CanopiFile,
  path: string | null,
  name: string,
  engine: CanvasEngine,
): void {
  engine.replaceDocument(file)
  replaceCurrentDesignState(file, path, name)
  resetDirtyBaselines()
  engine.history.clear()
  engine.showCanvasChrome()
}

function normalizeLoadedDocument(file: CanopiFile): CanopiFile {
  return {
    ...file,
    extra: extractExtra(file as unknown as Record<string, unknown>),
  }
}

function normalizeNewDocument(file: CanopiFile): CanopiFile {
  return {
    ...file,
    extra: {},
  }
}

function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.canopi$/i, '') || 'Untitled'
}

function isCancelled(error: unknown): boolean {
  return typeof error === 'string'
    ? error.includes('Dialog cancelled') || error.includes('cancelled')
    : error instanceof Error
    ? error.message.includes('cancelled')
    : false
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
