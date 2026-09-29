// canvas/runtime/input/platform.ts

export interface InputPlatform {
  readonly os: 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other'
  readonly engine: 'chromium' | 'webkit' | 'webkitgtk' | 'gecko'
  readonly gestureEvents: boolean          // WKWebView / Safari gesturestart/change/end
}
