/** Composite chart paints using both the CSS alpha and the renderer's globalAlpha. */
export function compositeChartColor(fill: string, background: string, opacity: number): string {
  return `rgb(${compositeChannels(fill, background, opacity).join(', ')})`
}

/** Choose ink against the rendered bar, including its opacity over the chart. */
export function chartLabelColor(fill: string, background: string, opacity: number): string {
  const linear = compositeChannels(fill, background, opacity).map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF'
}

function compositeChannels(fill: string, background: string, opacity: number): number[] {
  const foreground = channels(fill)
  const backdrop = channels(background)
  const alpha = opacity * foreground[3]!
  return foreground.slice(0, 3).map((value, index) => value * alpha + backdrop[index]! * (1 - alpha))
}

function channels(color: string): number[] {
  if (/^#[\da-f]{3}$/i.test(color)) {
    return [...[...color.slice(1)].map(value => parseInt(value + value, 16)), 1]
  }
  if (/^#[\da-f]{6}$/i.test(color)) {
    return [...[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)), 1]
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/i.exec(color)
  if (rgb) return [...rgb.slice(1, 4).map(Number), rgb[4] === undefined ? 1 : Number(rgb[4])]
  // Chart colors are normalized hex or computed RGB; retain light ink for unknown fills.
  return [0, 0, 0, 1]
}
