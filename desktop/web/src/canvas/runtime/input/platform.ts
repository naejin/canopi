// canvas/runtime/input/platform.ts
//
// Owns the platform facts the input pipeline depends on, read once from the user agent and injected everywhere else:
// interaction-session.ts calls detectPlatform in 0B; 0C moves the call to platform/desktop.ts and platform/browser.ts.
// Pure over its arguments, so tests pass literal user agents.

export interface InputPlatform {
  readonly os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other'
  readonly engine: 'chromium' | 'webkit' | 'webkitgtk' | 'gecko'
  readonly gestureEvents: boolean          // WKWebView / Safari gesturestart/change/end
}

export function detectPlatform(
  nav: Pick<Navigator, 'userAgent' | 'platform'>,
  win: { readonly GestureEvent?: unknown },
): InputPlatform {
  const agent = nav.userAgent
  const os = detectOs(agent, nav.platform)
  return {
    os,
    engine: detectEngine(agent, os),
    gestureEvents: win.GestureEvent !== undefined,
  }
}

function detectOs(agent: string, platform: string): InputPlatform['os'] {
  if (/iPhone|iPad|iPod/.test(agent)) return 'ios'
  if (/Android/.test(agent)) return 'android'
  if (/Windows|Win32|Win64/.test(agent) || /^Win/.test(platform)) return 'windows'
  if (/Macintosh|Mac OS X/.test(agent) || /^Mac/.test(platform)) return 'mac'
  if (/Linux|X11|CrOS/.test(agent) || /Linux/.test(platform)) return 'linux'
  return 'other'
}

function detectEngine(agent: string, os: InputPlatform['os']): InputPlatform['engine'] {
  if (/Firefox\//.test(agent)) return 'gecko'
  // Every iOS browser is WebKit, whatever brand its user agent names.
  if (os === 'ios') return 'webkit'
  if (/Chrome\/|Chromium\/|Edg\//.test(agent)) return 'chromium'
  // Tauri's Linux webview is WebKitGTK; its agent names AppleWebKit without Chrome.
  if (os === 'linux') return 'webkitgtk'
  return 'webkit'
}
