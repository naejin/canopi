import { signal } from '@preact/signals'

export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking'; source: 'background' | 'manual' }
  | {
      status: 'available'
      version: string
      body: string | null
      date: string | null
    }
  | {
      status: 'downloading'
      version: string
      downloaded: number
      contentLength: number | null
    }
  | { status: 'installed'; version: string }
  | {
      status: 'error'
      phase: 'check' | 'install' | 'relaunch'
      message: string
      retryAction: 'check' | 'install' | 'restart'
      version: string | null
    }

export const updaterState = signal<UpdaterState>({ status: 'idle' })
