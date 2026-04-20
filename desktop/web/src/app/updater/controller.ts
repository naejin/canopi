import { invoke } from '@tauri-apps/api/core'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { Update, type DownloadEvent } from '@tauri-apps/plugin-updater'
import { designDirty } from '../../state/design'
import { t } from '../../i18n'
import { persistCurrentSettings } from '../settings/persistence'
import { updateChannel } from '../settings/state'
import type { UpdateChannel } from '../../types/settings'
import { getUpdaterEndpoints, updaterEnabled } from './config'
import { updaterState } from './state'

type CheckOptions = {
  interactive?: boolean
  resetDismissal?: boolean
}

type UpdateMetadata = {
  rid: number
  currentVersion: string
  version: string
  date?: string
  body?: string
  rawJson: Record<string, unknown>
}

let updaterBootstrapped = false
const dismissedUpdates = new Set<string>()
let pendingUpdate: { channel: UpdateChannel; update: Update } | null = null
let latestCheckToken = 0

export type UpdaterBlockedAction = 'install' | 'restart'

function updateKey(channel: UpdateChannel, version: string): string {
  return `${channel}:${version}`
}

function clearDismissedChannel(channel: UpdateChannel): void {
  for (const key of dismissedUpdates) {
    if (key.startsWith(`${channel}:`)) {
      dismissedUpdates.delete(key)
    }
  }
}

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

async function checkForChannel(channel: UpdateChannel): Promise<Update | null> {
  const endpoints = getUpdaterEndpoints(channel)
  if (endpoints.length === 0) {
    throw new Error('Updater is not configured for this build.')
  }

  const metadata = await invoke<UpdateMetadata | null>('check_for_updates', {
    channel,
    endpoints,
  })

  return metadata ? new Update(metadata) : null
}

function availableStateFor(channel: UpdateChannel, update: Update) {
  return {
    status: 'available' as const,
    channel,
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
  const channel = updateChannel.peek()
  const checkToken = ++latestCheckToken

  if (resetDismissal) {
    clearDismissedChannel(channel)
  }

  const current = updaterState.peek()
  if (current.status === 'checking' || current.status === 'downloading') return

  if (interactive) {
    updaterState.value = { status: 'checking', source: 'manual', channel }
  }

  try {
    const update = await checkForChannel(channel)
    if (checkToken !== latestCheckToken) return
    pendingUpdate = update ? { channel, update } : null

    if (!update) {
      updaterState.value = { status: 'idle' }
      if (interactive) {
        await message(
          channel === 'beta' ? t('updater.upToDateBetaMessage') : t('updater.upToDateMessage'),
          {
            title: t('updater.dialogTitle'),
            kind: 'info',
          },
        )
      }
      return
    }

    if (!interactive && dismissedUpdates.has(updateKey(channel, update.version))) {
      updaterState.value = { status: 'idle' }
      return
    }

    updaterState.value = availableStateFor(channel, update)
  } catch (error) {
    if (checkToken !== latestCheckToken) return
    const normalized = normalizeUpdaterError(error)
    console.error('Failed to check for updates:', error)
    pendingUpdate = null
    updaterState.value = {
      status: 'error',
      channel,
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
    dismissedUpdates.add(updateKey(current.channel, current.version))
    updaterState.value = { status: 'idle' }
  }
}

export async function confirmUpdateChannelChange(
  previousChannel: UpdateChannel,
  nextChannel: UpdateChannel,
): Promise<boolean> {
  if (previousChannel === 'beta' && nextChannel === 'stable') {
    return ask(t('updater.channelStableNotice'), {
      title: t('updater.channelDialogTitle'),
      kind: 'warning',
    })
  }

  if (nextChannel === 'beta') {
    return ask(t('updater.channelBetaNotice'), {
      title: t('updater.channelDialogTitle'),
      kind: 'warning',
    })
  }

  return true
}

export async function applyUpdateChannelChangeEffects(
  nextChannel: UpdateChannel,
  options: { shouldRecheck: boolean },
): Promise<void> {
  if (pendingUpdate?.channel !== nextChannel) {
    pendingUpdate = null
    const current = updaterState.peek()
    if (current.status !== 'downloading' && current.status !== 'installed') {
      updaterState.value = { status: 'idle' }
    }
  }

  if (options.shouldRecheck && updaterEnabled) {
    await checkForUpdates({ resetDismissal: true })
  }
}

export async function setUpdateChannelPreference(nextChannel: UpdateChannel): Promise<void> {
  const previousChannel = updateChannel.peek()
  if (previousChannel === nextChannel) return

  const confirmed = await confirmUpdateChannelChange(previousChannel, nextChannel)
  if (!confirmed) return

  updateChannel.value = nextChannel
  persistCurrentSettings()
  await applyUpdateChannelChangeEffects(nextChannel, { shouldRecheck: true })
}

export async function installAvailableUpdate(): Promise<void> {
  if (!pendingUpdate) {
    await checkForUpdates({ interactive: true, resetDismissal: true })
    return
  }

  if (pendingUpdate.channel !== updateChannel.peek()) {
    pendingUpdate = null
    updaterState.value = { status: 'idle' }
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

  const { channel, update } = pendingUpdate

  updaterState.value = {
    status: 'downloading',
    channel,
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
          channel,
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
          channel: current.status === 'downloading' ? current.channel : channel,
          version: current.status === 'downloading' ? current.version : update.version,
          downloaded,
          contentLength: current.status === 'downloading' ? current.contentLength : null,
        }
      }
    })

    const version = update.version
    pendingUpdate = null
    updaterState.value = { status: 'installed', channel, version }
  } catch (error) {
    const normalized = normalizeUpdaterError(error)
    console.error('Failed to install update:', error)
    updaterState.value = {
      status: 'error',
      channel,
      phase: 'install',
      message: normalized,
      retryAction: 'install',
      version: pendingUpdate?.update.version ?? null,
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

  if (
    current.retryAction === 'install' &&
    pendingUpdate &&
    pendingUpdate.channel === updateChannel.peek()
  ) {
    await installAvailableUpdate()
    return
  }

  await checkForUpdates({ interactive: true, resetDismissal: true })
}

export async function restartToApplyUpdate(): Promise<void> {
  const current = updaterState.peek()
  const installedVersion = current.status === 'installed' ? current.version : null
  const installedChannel = current.status === 'installed' ? current.channel : updateChannel.peek()

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
      channel: installedChannel,
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
    dismissedUpdates.clear()
    pendingUpdate = null
    updaterState.value = { status: 'idle' }
  })
}
