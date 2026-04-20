import { signal } from '@preact/signals'
import type { UpdateChannel } from '../../types/settings'

export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking'; source: 'background' | 'manual'; channel: UpdateChannel }
  | {
      status: 'available'
      channel: UpdateChannel
      version: string
      body: string | null
      date: string | null
    }
  | {
      status: 'downloading'
      channel: UpdateChannel
      version: string
      downloaded: number
      contentLength: number | null
    }
  | { status: 'installed'; channel: UpdateChannel; version: string }
  | {
      status: 'error'
      channel: UpdateChannel
      phase: 'check' | 'install' | 'relaunch'
      message: string
      retryAction: 'check' | 'install' | 'restart'
      version: string | null
    }

export const updaterState = signal<UpdaterState>({ status: 'idle' })
