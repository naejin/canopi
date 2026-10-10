// canvas/runtime/input/platform.ts
//
// Owns the platform facts the input pipeline depends on, read from the user agent: the OS (the chord rule, the mod key
// and iOS's one twist source; iPadOS is iOS) and WebKit gesture events. There is no engine sniffing. Pure over its arguments, so tests pass literal
// user agents. Its callers: the interaction session (unless a test injects one), the editions' key routers
// (platform/desktop.ts, web/browser-shell-commands.ts), and the inspection lens and PDF page editor for the mod key.

export interface InputPlatform {
  readonly os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other'
  readonly gestureEvents: boolean          // WKWebView / Safari gesturestart/change/end
}

export function detectPlatform(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
  win: { readonly GestureEvent?: unknown },
): InputPlatform {
  return {
    os: isIpadDesktopUserAgent(nav.userAgent, nav.maxTouchPoints) ? 'ios' : detectOs(nav.userAgent, nav.platform),
    gestureEvents: win.GestureEvent !== undefined,
  }
}

/** Whether the mod key is Cmd: macOS, and iPadOS keyboards, as the key router's chord rule reads them. */
export function modKeyIsCmd(platform: Pick<InputPlatform, 'os'>): boolean {
  return platform.os === 'mac' || platform.os === 'ios'
}

/**
 * iPadOS Safari asks for desktop sites by default, so its user agent reads as a Mac's; only its touch points tell it
 * apart (A8). Copied from GeoLibre `packages/core/src/platform.ts` (isIpadDesktopUserAgent), MIT License, Copyright (c)
 * 2026 Qiusheng Wu.
 */
function isIpadDesktopUserAgent(userAgent: string, maxTouchPoints: number | undefined): boolean {
  return /Macintosh/.test(userAgent) && (maxTouchPoints ?? 0) > 1
}

function detectOs(agent: string, platform: string): InputPlatform['os'] {
  if (/iPhone|iPad|iPod/.test(agent)) return 'ios'
  if (/Android/.test(agent)) return 'android'
  if (/Windows|Win32|Win64/.test(agent) || /^Win/.test(platform)) return 'windows'
  if (/Macintosh|Mac OS X/.test(agent) || /^Mac/.test(platform)) return 'mac'
  if (/Linux|X11|CrOS/.test(agent) || /Linux/.test(platform)) return 'linux'
  return 'other'
}
