import { describe, expect, it } from 'vitest'
import { detectPlatform } from './platform'

const WINDOWS_WEBVIEW2 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const MAC_WKWEBVIEW = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0'
const LINUX_WEBKITGTK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const IPAD_CHROME = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

describe('detectPlatform', () => {
  it.each([
    ['WebView2', WINDOWS_WEBVIEW2, 'Win32', { os: 'windows' }],
    ['WKWebView', MAC_WKWEBVIEW, 'MacIntel', { os: 'mac' }],
    ['Firefox on macOS', MAC_FIREFOX, 'MacIntel', { os: 'mac' }],
    ['WebKitGTK', LINUX_WEBKITGTK, 'Linux x86_64', { os: 'linux' }],
    ['Chrome on Linux', LINUX_CHROME, 'Linux x86_64', { os: 'linux' }],
    ['Chrome on iPad', IPAD_CHROME, 'iPad', { os: 'ios' }],
    ['Chrome on Android', ANDROID_CHROME, 'Linux armv8l', { os: 'android' }],
    ['an unknown agent', 'Unknown/1.0', '', { os: 'other' }],
  ])('reads %s from its user agent', (_name, userAgent, platform, expected) => {
    expect(detectPlatform({ userAgent, platform }, {})).toEqual({ ...expected, gestureEvents: false })
  })

  it('reports WebKit gesture events when GestureEvent exists', () => {
    expect(detectPlatform({ userAgent: MAC_WKWEBVIEW, platform: 'MacIntel' }, { GestureEvent: class {} }).gestureEvents).toBe(true)
  })
})
