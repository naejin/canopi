import type { CameraViewportSnapshot } from './runtime/camera'

/** One CSS pixel on screen is 1/96 inch. */
export const CSS_PIXEL_METERS = 0.0254 / 96

/** Common scales offered by the zoom group's scale menu. */
export const COMMON_MAP_SCALES: readonly number[] = [100, 200, 500, 1000, 2000, 5000, 10000, 25000]

/** Ground metres one CSS pixel covers: the map's ground resolution when a map is attached. */
export function groundMetersPerCssPixel(frame: CameraViewportSnapshot): number {
  if (frame.groundMetersPerCssPixel !== null && frame.groundMetersPerCssPixel > 0) {
    return frame.groundMetersPerCssPixel
  }
  return frame.viewport.scale > 0 ? 1 / frame.viewport.scale : 1
}

/** The N of "1:N", unrounded. */
export function mapScaleDenominator(frame: CameraViewportSnapshot): number {
  return groundMetersPerCssPixel(frame) / CSS_PIXEL_METERS
}

/** Two significant figures: a readable ratio (1:190, 1:1,500, 1:50,000,000). */
export function roundScaleDenominator(denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 1
  const power = 10 ** Math.max(0, Math.floor(Math.log10(denominator)) - 1)
  return Math.max(1, Math.round(denominator / power) * power)
}

export function formatMapScale(denominator: number, locale: string): string {
  return `1:${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(roundScaleDenominator(denominator))}`
}

/** Zoom factor that turns the current scale into `1:target`. */
export function zoomFactorForScale(currentDenominator: number, targetDenominator: number): number {
  return currentDenominator / targetDenominator
}
