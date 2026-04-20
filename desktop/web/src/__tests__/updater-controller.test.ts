import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: mocks.ask,
  message: mocks.message,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mocks.relaunch,
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class FakeUpdate {
    available = true
    currentVersion: string
    version: string
    date?: string
    body?: string
    rawJson: Record<string, unknown>
    downloadAndInstall?: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>

    constructor(metadata: any) {
      this.currentVersion = metadata.currentVersion
      this.version = metadata.version
      this.date = metadata.date
      this.body = metadata.body
      this.rawJson = metadata.rawJson ?? {}
      this.downloadAndInstall = metadata.downloadAndInstall
    }
  },
}))

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => {
    switch (key) {
      case 'updater.dialogTitle':
        return 'Updates'
      case 'updater.channelDialogTitle':
        return 'Update channel'
      case 'updater.upToDateMessage':
        return 'Canopi is up to date.'
      case 'updater.upToDateBetaMessage':
        return 'Canopi beta channel is up to date.'
      case 'updater.notConfigured':
        return 'Updater is not configured for this build.'
      case 'updater.saveBeforeInstallTitle':
        return 'Save changes before installing'
      case 'updater.saveBeforeInstallMessage':
        return 'Save or close your current document before installing this update.'
      case 'updater.saveBeforeRestartTitle':
        return 'Save changes before restarting'
      case 'updater.saveBeforeRestartMessage':
        return 'Save or close your current document before restarting into the updated version.'
      case 'updater.channelBetaNotice':
        return 'Beta builds can be less stable. Future update checks will use the beta channel.'
      case 'updater.channelStableNotice':
        return 'Future update checks will use the stable channel. Canopi will not downgrade automatically, so this beta build may remain newer until stable catches up.'
      case 'updater.available':
        return `Canopi ${vars?.version ?? ''} is available`
      case 'updater.availableBeta':
        return `Canopi ${vars?.version ?? ''} is available on beta`
      default:
        return key
    }
  },
}))

vi.mock('../app/updater/config', () => ({
  UPDATE_CHANNELS: ['stable', 'beta'],
  updaterEnabled: true,
  getUpdaterEndpoints: (channel: string) => [`https://updates.example.com/${channel}/latest.json`],
}))

function updateMetadata(version: string, overrides: Record<string, unknown> = {}) {
  return {
    rid: 1,
    currentVersion: '0.4.0',
    version,
    date: '2026-04-14T00:00:00Z',
    body: null,
    rawJson: {},
    ...overrides,
  }
}

describe('updater controller', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.invoke.mockReset()
    mocks.ask.mockReset()
    mocks.message.mockReset()
    mocks.relaunch.mockReset()
    mocks.ask.mockResolvedValue(true)

    const design = await import('../state/design')
    const updaterState = await import('../app/updater/state')
    const { setBootstrappedSettings } = await import('../app/settings/persistence')
    const { setSettings } = await import('../ipc/settings')

    design.resetDirtyBaselines()
    updaterState.updaterState.value = { status: 'idle' }
    vi.mocked(setSettings).mockReset()
    vi.mocked(setSettings).mockResolvedValue(undefined)
    setBootstrappedSettings({
      locale: 'en',
      theme: 'light',
      snap_to_grid: true,
      snap_to_guides: true,
      show_smart_guides: true,
      auto_save_interval_s: 60,
      confirm_destructive: true,
      default_currency: 'EUR',
      measurement_units: 'metric',
      show_botanical_names: true,
      debug_logging: false,
      check_updates: true,
      update_channel: 'stable',
      default_design_dir: '',
      recent_files_max: 20,
      last_active_panel: 'canvas',
      bottom_panel_open: false,
      bottom_panel_height: 200,
      bottom_panel_tab: 'budget',
      map_layer_visible: true,
      map_style: 'street',
      map_opacity: 1,
      contour_visible: false,
      contour_opacity: 1,
      contour_interval: 0,
      hillshade_visible: false,
      hillshade_opacity: 0.55,
    })
  })

  it('shows an up-to-date dialog for interactive checks with no update', async () => {
    mocks.invoke.mockResolvedValue(null)

    const { checkForUpdates } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    await checkForUpdates({ interactive: true })

    expect(mocks.invoke).toHaveBeenCalledWith('check_for_updates', {
      channel: 'stable',
      endpoints: ['https://updates.example.com/stable/latest.json'],
    })
    expect(mocks.message).toHaveBeenCalledWith('Canopi is up to date.', expect.objectContaining({
      title: 'Updates',
    }))
    expect(updaterState.value).toEqual({ status: 'idle' })
  })

  it('keeps dismissed updates channel-specific', async () => {
    mocks.invoke
      .mockResolvedValueOnce(updateMetadata('0.5.0'))
      .mockResolvedValueOnce(updateMetadata('0.5.0'))

    const { checkForUpdates, dismissUpdate } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')
    const { updateChannel } = await import('../app/settings/state')

    await checkForUpdates({ interactive: true })
    dismissUpdate()

    updateChannel.value = 'beta'
    await checkForUpdates()

    expect(updaterState.value).toMatchObject({
      status: 'available',
      channel: 'beta',
      version: '0.5.0',
    })
  })

  it('keeps background checks silent while checking', async () => {
    const deferred: { resolve: null | ((value: null) => void) } = { resolve: null }
    mocks.invoke.mockImplementation(() => new Promise<null>((resolve) => {
      deferred.resolve = resolve
    }))

    const { checkForUpdates } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    const pending = checkForUpdates()
    expect(updaterState.value).toEqual({ status: 'idle' })

    deferred.resolve?.(null)
    await pending
  })

  it('ignores stale check results after a channel switch', async () => {
    let resolveStable: ((value: Record<string, unknown> | null) => void) | null = null
    mocks.invoke
      .mockImplementationOnce(() => new Promise<Record<string, unknown> | null>((resolve) => {
        resolveStable = resolve
      }))
      .mockResolvedValueOnce(updateMetadata('0.5.0-beta.1'))

    const { checkForUpdates, setUpdateChannelPreference } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    const stableCheck = checkForUpdates()
    await setUpdateChannelPreference('beta')

    expect(updaterState.value).toMatchObject({
      status: 'available',
      channel: 'beta',
      version: '0.5.0-beta.1',
    })

    if (!resolveStable) {
      throw new Error('Stable check did not register a resolver')
    }
    const stableResolver = resolveStable as (value: Record<string, unknown> | null) => void
    stableResolver(updateMetadata('0.5.0'))
    await stableCheck

    expect(updaterState.value).toMatchObject({
      status: 'available',
      channel: 'beta',
      version: '0.5.0-beta.1',
    })
  })

  it('warns and persists when switching to beta', async () => {
    mocks.invoke.mockResolvedValue(null)

    const { setUpdateChannelPreference } = await import('../app/updater/controller')
    const { updateChannel } = await import('../app/settings/state')
    const { setSettings } = await import('../ipc/settings')

    await setUpdateChannelPreference('beta')

    expect(updateChannel.value).toBe('beta')
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      update_channel: 'beta',
    }))
    expect(mocks.ask).toHaveBeenCalledWith(
      'Beta builds can be less stable. Future update checks will use the beta channel.',
      expect.objectContaining({ title: 'Update channel' }),
    )
    expect(mocks.invoke).toHaveBeenCalledWith('check_for_updates', {
      channel: 'beta',
      endpoints: ['https://updates.example.com/beta/latest.json'],
    })
  })

  it('warns that switching to stable does not downgrade', async () => {
    mocks.invoke.mockResolvedValue(null)

    const { setUpdateChannelPreference } = await import('../app/updater/controller')
    const { updateChannel } = await import('../app/settings/state')

    updateChannel.value = 'beta'
    await setUpdateChannelPreference('stable')

    expect(updateChannel.value).toBe('stable')
    expect(mocks.ask).toHaveBeenCalledWith(
      'Future update checks will use the stable channel. Canopi will not downgrade automatically, so this beta build may remain newer until stable catches up.',
      expect.objectContaining({ title: 'Update channel' }),
    )
  })

  it('does not switch channels when the warning is cancelled', async () => {
    mocks.ask.mockResolvedValue(false)

    const { setUpdateChannelPreference } = await import('../app/updater/controller')
    const { updateChannel } = await import('../app/settings/state')
    const { setSettings } = await import('../ipc/settings')

    await setUpdateChannelPreference('beta')

    expect(updateChannel.value).toBe('stable')
    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('blocks installation while the current document is dirty', async () => {
    const downloadAndInstall = vi.fn()
    mocks.invoke.mockResolvedValue(updateMetadata('0.5.0', { downloadAndInstall }))

    const design = await import('../state/design')
    const { checkForUpdates, installAvailableUpdate } = await import('../app/updater/controller')

    await checkForUpdates({ interactive: true })
    design.nonCanvasRevision.value = 1
    await installAvailableUpdate()

    expect(downloadAndInstall).not.toHaveBeenCalled()
    expect(mocks.message).toHaveBeenCalledWith(
      'Save or close your current document before installing this update.',
      expect.objectContaining({ title: 'Save changes before installing' }),
    )
  })

  it('rechecks instead of installing an update from the previous channel', async () => {
    const stableInstall = vi.fn()
    mocks.invoke
      .mockResolvedValueOnce(updateMetadata('0.5.0', { downloadAndInstall: stableInstall }))
      .mockResolvedValueOnce(null)

    const { checkForUpdates, installAvailableUpdate } = await import('../app/updater/controller')
    const { updateChannel } = await import('../app/settings/state')

    await checkForUpdates({ interactive: true })
    updateChannel.value = 'beta'
    await installAvailableUpdate()

    expect(stableInstall).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenLastCalledWith('check_for_updates', {
      channel: 'beta',
      endpoints: ['https://updates.example.com/beta/latest.json'],
    })
  })

  it('installs an available update and relaunches on demand', async () => {
    const downloadAndInstall = vi.fn().mockImplementation(async (onEvent: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 25 } })
      onEvent({ event: 'Finished' })
    })
    mocks.invoke.mockResolvedValue(updateMetadata('0.5.0-beta.1', { downloadAndInstall }))

    const { checkForUpdates, installAvailableUpdate, restartToApplyUpdate } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')
    const { updateChannel } = await import('../app/settings/state')

    updateChannel.value = 'beta'
    await checkForUpdates({ interactive: true })
    await installAvailableUpdate()

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(updaterState.value).toEqual({
      status: 'installed',
      channel: 'beta',
      version: '0.5.0-beta.1',
    })

    await restartToApplyUpdate()
    expect(mocks.relaunch).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying the install path after an install failure on the same channel', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('network down'))
    mocks.invoke.mockResolvedValue(updateMetadata('0.5.0-beta.1', { downloadAndInstall }))

    const { checkForUpdates, installAvailableUpdate, retryUpdateAction } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')
    const { updateChannel } = await import('../app/settings/state')

    updateChannel.value = 'beta'
    await checkForUpdates({ interactive: true })
    await installAvailableUpdate()

    expect(updaterState.value).toMatchObject({
      status: 'error',
      channel: 'beta',
      phase: 'install',
      retryAction: 'install',
      version: '0.5.0-beta.1',
    })

    downloadAndInstall.mockResolvedValue(undefined)
    await retryUpdateAction()

    expect(downloadAndInstall).toHaveBeenCalledTimes(2)
  })
})
