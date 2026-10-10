// The browser's geolocation, the one module that calls it (canopi-f47t.53; plan P53; design check A4 and §4).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  geolocationSupported,
  queryGeolocationPermission,
  watchDevicePosition,
} from './geolocation'

const descriptors = {
  geolocation: Object.getOwnPropertyDescriptor(navigator, 'geolocation'),
  permissions: Object.getOwnPropertyDescriptor(navigator, 'permissions'),
  isSecureContext: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
}

function stub(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { configurable: true, value })
}

afterEach(() => {
  for (const [name, descriptor] of Object.entries(descriptors)) {
    const target = name === 'isSecureContext' ? window : navigator
    if (descriptor) Object.defineProperty(target, name, descriptor)
    else delete (target as unknown as Record<string, unknown>)[name]
  }
})

function position(longitude: number, latitude: number, accuracy: number, timestamp: number): GeolocationPosition {
  return { coords: { longitude, latitude, accuracy }, timestamp } as GeolocationPosition
}

describe('the browser geolocation module', () => {
  it('is supported only in a secure context with navigator.geolocation (design check A1)', () => {
    stub(window, 'isSecureContext', true)
    stub(navigator, 'geolocation', { watchPosition: vi.fn(), clearWatch: vi.fn() })
    expect(geolocationSupported()).toBe(true)
    stub(window, 'isSecureContext', false)
    expect(geolocationSupported()).toBe(false)
    stub(window, 'isSecureContext', true)
    stub(navigator, 'geolocation', undefined)
    expect(geolocationSupported()).toBe(false)
  })

  it('watches with watchPosition only, hands over each fix as lon, lat, accuracy and time, and stops with clearWatch', () => {
    let success!: PositionCallback
    let failure!: PositionErrorCallback
    const geolocation = {
      watchPosition: vi.fn((onFix: PositionCallback, onError: PositionErrorCallback) => { success = onFix; failure = onError; return 7 }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    }
    stub(navigator, 'geolocation', geolocation)
    const fixes: unknown[] = []
    const errors: number[] = []
    const stop = watchDevicePosition((fix) => fixes.push(fix), (code) => errors.push(code))

    expect(geolocation.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 })
    success(position(2.35, 48.85, 12, 1_760_000_000_000))
    failure({ code: 2, message: '' } as GeolocationPositionError)
    failure({ code: 3, message: 'Timeout expired' } as GeolocationPositionError)
    failure({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
    expect(fixes).toEqual([{ lon: 2.35, lat: 48.85, accuracy: 12, timestamp: 1_760_000_000_000 }])
    expect(errors).toEqual([2, 3, 1])

    stop()
    expect(geolocation.clearWatch).toHaveBeenCalledOnce()
    expect(geolocation.clearWatch).toHaveBeenCalledWith(7)
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('reads the permission state, or null without a Permissions API or when query throws or rejects (GeoLibre\'s rule)', async () => {
    const status = { state: 'denied' }
    stub(navigator, 'permissions', { query: vi.fn(async () => status) })
    expect(await queryGeolocationPermission()).toBe(status)
    expect(navigator.permissions.query).toHaveBeenCalledWith({ name: 'geolocation' })

    stub(navigator, 'permissions', undefined)
    expect(await queryGeolocationPermission()).toBeNull()
    stub(navigator, 'permissions', { query: vi.fn(() => { throw new TypeError('unsupported') }) })
    expect(await queryGeolocationPermission()).toBeNull()
    stub(navigator, 'permissions', { query: vi.fn(async () => { throw new TypeError('unsupported') }) })
    expect(await queryGeolocationPermission()).toBeNull()
  })
})
