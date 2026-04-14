import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: mocks.message,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mocks.relaunch,
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}))

vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => {
    switch (key) {
      case 'updater.dialogTitle':
        return 'Updates'
      case 'updater.upToDateMessage':
        return 'Canopi is up to date.'
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
      case 'updater.available':
        return `Canopi ${vars?.version ?? ''} is available`
      default:
        return key
    }
  },
}))

vi.mock('../app/updater/config', () => ({
  updaterEnabled: true,
}))

describe('updater controller', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.check.mockReset()
    mocks.message.mockReset()
    mocks.relaunch.mockReset()

    const design = await import('../state/design')
    const updaterState = await import('../app/updater/state')
    design.resetDirtyBaselines()
    updaterState.updaterState.value = { status: 'idle' }
  })

  it('shows an up-to-date dialog for interactive checks with no update', async () => {
    mocks.check.mockResolvedValue(null)

    const { checkForUpdates } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    await checkForUpdates({ interactive: true })

    expect(mocks.message).toHaveBeenCalledWith('Canopi is up to date.', expect.objectContaining({
      title: 'Updates',
    }))
    expect(updaterState.value).toEqual({ status: 'idle' })
  })

  it('suppresses a dismissed update on a later background check', async () => {
    const update = {
      version: '0.5.0',
      body: 'notes',
      date: '2026-04-14T00:00:00Z',
      downloadAndInstall: vi.fn(),
    }
    mocks.check.mockResolvedValue(update)

    const { checkForUpdates, dismissUpdate } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    await checkForUpdates({ interactive: true })
    expect(updaterState.value).toMatchObject({ status: 'available', version: '0.5.0' })

    dismissUpdate()
    await checkForUpdates()

    expect(updaterState.value).toEqual({ status: 'idle' })
  })

  it('keeps background checks silent while checking', async () => {
    const deferred: { resolve: null | (() => void) } = { resolve: null }
    mocks.check.mockImplementation(() => new Promise<null>((resolve) => {
      deferred.resolve = () => resolve(null)
    }))

    const { checkForUpdates } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    const pending = checkForUpdates()
    expect(updaterState.value).toEqual({ status: 'idle' })

    if (deferred.resolve) {
      deferred.resolve()
    }
    await pending
  })

  it('blocks installation while the current document is dirty', async () => {
    const downloadAndInstall = vi.fn()
    mocks.check.mockResolvedValue({
      version: '0.5.0',
      body: null,
      date: null,
      downloadAndInstall,
    })

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

  it('installs an available update and relaunches on demand', async () => {
    const downloadAndInstall = vi.fn().mockImplementation(async (onEvent: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 25 } })
      onEvent({ event: 'Finished' })
    })
    mocks.check.mockResolvedValue({
      version: '0.5.0',
      body: null,
      date: null,
      downloadAndInstall,
    })

    const { checkForUpdates, installAvailableUpdate, restartToApplyUpdate } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    await checkForUpdates({ interactive: true })
    await installAvailableUpdate()

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(updaterState.value).toEqual({ status: 'installed', version: '0.5.0' })

    await restartToApplyUpdate()
    expect(mocks.relaunch).toHaveBeenCalledTimes(1)
  })

  it('blocks restart when new unsaved work appears after install', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    mocks.check.mockResolvedValue({
      version: '0.5.0',
      body: null,
      date: null,
      downloadAndInstall,
    })

    const design = await import('../state/design')
    const { checkForUpdates, installAvailableUpdate, restartToApplyUpdate } = await import('../app/updater/controller')

    await checkForUpdates({ interactive: true })
    await installAvailableUpdate()
    design.nonCanvasRevision.value = 1
    await restartToApplyUpdate()

    expect(mocks.relaunch).not.toHaveBeenCalled()
    expect(mocks.message).toHaveBeenCalledWith(
      'Save or close your current document before restarting into the updated version.',
      expect.objectContaining({ title: 'Save changes before restarting' }),
    )
  })

  it('keeps retrying the install path after an install failure', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('network down'))
    mocks.check.mockResolvedValue({
      version: '0.5.0',
      body: null,
      date: null,
      downloadAndInstall,
    })

    const { checkForUpdates, installAvailableUpdate, retryUpdateAction } = await import('../app/updater/controller')
    const { updaterState } = await import('../app/updater/state')

    await checkForUpdates({ interactive: true })
    await installAvailableUpdate()

    expect(updaterState.value).toMatchObject({
      status: 'error',
      phase: 'install',
      retryAction: 'install',
      version: '0.5.0',
    })

    downloadAndInstall.mockResolvedValue(undefined)
    await retryUpdateAction()

    expect(downloadAndInstall).toHaveBeenCalledTimes(2)
  })
})
