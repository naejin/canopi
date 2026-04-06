import { message } from '@tauri-apps/plugin-dialog'
import type { CanopiFile } from '../types/design'
import { getCurrentCanvasSession, type CanvasSession } from '../canvas/session'
import * as designIpc from '../ipc/design'
import { t } from '../i18n'
import { extractExtra } from './document-extra'
import { syncDesignLocationMirror } from './document-mutations'
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
  session?: CanvasSession | null
  isCancelled?: () => boolean
}

type ReplacementDecision = 'proceed' | 'cancel'
export type TemplateOpenResult = 'opened' | 'queued' | 'cancelled'

function buildPersistedContent(session: CanvasSession | null): CanopiFile {
  if (session) {
    return session.serializeDocument({ name: designName.value }, currentDesign.value)
  }

  const design = currentDesign.value
  if (!design) throw new Error('No design loaded')
  return {
    ...design,
    name: designName.value,
  }
}

/** Save to the current path (Ctrl+S). Opens Save As if no path exists yet. */
export async function saveCurrentDesign(): Promise<void> {
  const session = getCurrentCanvasSession()
  const content = buildPersistedContent(session)

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
  const session = getCurrentCanvasSession()
  const content = buildPersistedContent(session)

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
  const session = getCurrentCanvasSession()
  if (!session) return

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  try {
    const { file, path } = await designIpc.openDesignDialog()
    applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, session)
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
  const session = options.session ?? getCurrentCanvasSession()
  if (!session) {
    pendingDesignPath.value = path
    return
  }

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, session)
}

/** Open a downloaded template as a new unsaved design through the shared guard. */
export async function openDesignAsTemplate(
  path: string,
  name: string,
  options: DocumentLoadOptions = {},
): Promise<TemplateOpenResult> {
  const session = options.session ?? getCurrentCanvasSession()
  if (!session) {
    pendingTemplateImport.value = { path, name }
    return 'queued'
  }

  const decision = await confirmReplacement()
  if (decision === 'cancel') return 'cancelled'

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return 'cancelled'

  applyDocumentReplacement(normalizeLoadedDocument(file), null, name, session)
  return 'opened'
}

/** Create a new blank design through the shared replacement guard. */
export async function newDesignAction(): Promise<void> {
  const session = getCurrentCanvasSession()
  if (!session) return

  const decision = await confirmReplacement()
  if (decision === 'cancel') return

  const file = await designIpc.newDesign()
  applyDocumentReplacement(normalizeNewDocument(file), null, 'Untitled', session)
}

/** Consume a queued document load when CanvasPanel mounts a fresh engine.
 *  Bypasses the dirty guard — queued loads happen on fresh mount before the
 *  user has interacted, so prompting to save is semantically wrong. */
export function consumeQueuedDocumentLoad(session: CanvasSession): () => void {
  const queuedTemplate = pendingTemplateImport.value
  if (queuedTemplate) {
    let cancelled = false
    void loadTemplateDirect(queuedTemplate.path, queuedTemplate.name, {
      session,
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
    session,
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
  const session = options.session ?? getCurrentCanvasSession()
  if (!session) {
    pendingDesignPath.value = path
    return
  }

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), path, file.name, session)
}

async function loadTemplateDirect(
  path: string,
  name: string,
  options: DocumentLoadOptions = {},
): Promise<void> {
  const session = options.session ?? getCurrentCanvasSession()
  if (!session) {
    pendingTemplateImport.value = { path, name }
    return
  }

  const file = await designIpc.loadDesign(path)
  if (options.isCancelled?.()) return

  applyDocumentReplacement(normalizeLoadedDocument(file), null, name, session)
}

function applyDocumentReplacement(
  file: CanopiFile,
  path: string | null,
  name: string,
  session: CanvasSession,
): void {
  session.replaceDocument(file)
  replaceCurrentDesignState(file, path, name)
  syncDesignLocationMirror(file)
  resetDirtyBaselines()
  session.clearHistory()
  session.showCanvasChrome()
}

function normalizeDocument(file: CanopiFile, extra: Record<string, unknown>): CanopiFile {
  return { ...file, annotations: file.annotations ?? [], extra }
}

function normalizeLoadedDocument(file: CanopiFile): CanopiFile {
  return normalizeDocument(file, extractExtra(file as unknown as Record<string, unknown>))
}

function normalizeNewDocument(file: CanopiFile): CanopiFile {
  return normalizeDocument(file, {})
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
