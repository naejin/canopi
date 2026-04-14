import { message } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { designDirty } from '../../state/design'
import { t } from '../../i18n'
import { updaterState } from './state'

type CheckOptions = {
  interactive?: boolean
  resetDismissal?: boolean
}

let updaterBootstrapped = false
let dismissedVersion: string | null = null
let pendingUpdate: Update | null = null

export type UpdaterBlockedAction = 'install' | 'restart'

function normalizeUpdaterError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  const normalized = message.toLowerCase()

  if (
    normalized.includes('plugin') ||
    normalized.includes('updater disabled') ||
    normalized.includes('not set at build time') ||
    normalized.includes('not initialized')
  ) {
    return t('updater.notConfigured')
  }

  return message
}

function availableStateFor(update: Update) {
  return {
    status: 'available' as const,
    version: update.version,
    body: update.body ?? null,
    date: update.date ?? null,
  }
}

export function getUpdaterBlockedReason(action: UpdaterBlockedAction): string | null {
  if (!designDirty.value) return null

  return action === 'install'
    ? t('updater.saveBeforeInstallInline')
    : t('updater.saveBeforeRestartInline')
}

export function bootstrapUpdater(checkOnLaunch: boolean): void {
  if (updaterBootstrapped) return
  updaterBootstrapped = true

  if (checkOnLaunch) {
    void checkForUpdates()
  }
}

export async function checkForUpdates(options: CheckOptions = {}): Promise<void> {
  const { interactive = false, resetDismissal = false } = options

  if (resetDismissal) {
    dismissedVersion = null
  }

  const current = updaterState.peek()
  if (current.status === 'checking' || current.status === 'downloading') return

  if (interactive) {
    updaterState.value = { status: 'checking', source: 'manual' }
  }

  try {
    const update = await check()
    pendingUpdate = update

    if (!update) {
      updaterState.value = { status: 'idle' }
      if (interactive) {
        await message(t('updater.upToDateMessage'), {
          title: t('updater.dialogTitle'),
          kind: 'info',
        })
      }
      return
    }

    if (!interactive && dismissedVersion === update.version) {
      updaterState.value = { status: 'idle' }
      return
    }

    updaterState.value = availableStateFor(update)
  } catch (error) {
    const normalized = normalizeUpdaterError(error)
    console.error('Failed to check for updates:', error)
    pendingUpdate = null
    updaterState.value = {
      status: 'error',
      phase: 'check',
      message: normalized,
      retryAction: 'check',
      version: null,
    }

    if (!interactive) {
      updaterState.value = { status: 'idle' }
    }
  }
}

export function dismissUpdate(): void {
  const current = updaterState.peek()
  if (current.status === 'available') {
    dismissedVersion = current.version
    updaterState.value = { status: 'idle' }
  }
}

export async function installAvailableUpdate(): Promise<void> {
  if (!pendingUpdate) {
    await checkForUpdates({ interactive: true, resetDismissal: true })
    return
  }

  const blockedReason = getUpdaterBlockedReason('install')
  if (blockedReason) {
    await message(t('updater.saveBeforeInstallMessage'), {
      title: t('updater.saveBeforeInstallTitle'),
      kind: 'warning',
    })
    return
  }

  const update = pendingUpdate

  updaterState.value = {
    status: 'downloading',
    version: update.version,
    downloaded: 0,
    contentLength: null,
  }

  try {
    let downloaded = 0
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        updaterState.value = {
          status: 'downloading',
          version: update.version,
          downloaded: 0,
          contentLength: event.data.contentLength ?? null,
        }
        return
      }

      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        const current = updaterState.peek()
        updaterState.value = {
          status: 'downloading',
          version: current.status === 'downloading' ? current.version : update.version,
          downloaded,
          contentLength: current.status === 'downloading' ? current.contentLength : null,
        }
      }
    })

    const version = update.version
    pendingUpdate = null
    updaterState.value = { status: 'installed', version }
  } catch (error) {
    const normalized = normalizeUpdaterError(error)
    console.error('Failed to install update:', error)
    updaterState.value = {
      status: 'error',
      phase: 'install',
      message: normalized,
      retryAction: 'install',
      version: pendingUpdate?.version ?? null,
    }
  }
}

export async function retryUpdateAction(): Promise<void> {
  const current = updaterState.peek()
  if (current.status !== 'error') return

  if (current.retryAction === 'restart') {
    await restartToApplyUpdate()
    return
  }

  if (current.retryAction === 'install' && pendingUpdate) {
    await installAvailableUpdate()
    return
  }

  await checkForUpdates({ interactive: true, resetDismissal: true })
}

export async function restartToApplyUpdate(): Promise<void> {
  const current = updaterState.peek()
  const installedVersion = current.status === 'installed' ? current.version : null

  const blockedReason = getUpdaterBlockedReason('restart')
  if (blockedReason) {
    await message(t('updater.saveBeforeRestartMessage'), {
      title: t('updater.saveBeforeRestartTitle'),
      kind: 'warning',
    })
    return
  }

  try {
    await relaunch()
  } catch (error) {
    const normalized = normalizeUpdaterError(error)
    console.error('Failed to relaunch after update:', error)
    updaterState.value = {
      status: 'error',
      phase: 'relaunch',
      message: normalized,
      retryAction: 'restart',
      version: installedVersion,
    }
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    updaterBootstrapped = false
    dismissedVersion = null
    pendingUpdate = null
    updaterState.value = { status: 'idle' }
  })
}
