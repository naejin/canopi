/** Choose ink against the rendered bar, including its opacity over the chart. */
export function chartLabelColor(fill: string, background: string, opacity: number): string {
  const foreground = channels(fill)
  const backdrop = channels(background)
  const linear = foreground.map((value, index) => {
    const channel = (value * opacity + backdrop[index]! * (1 - opacity)) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  // Black and white guarantee the stronger available contrast for arbitrary species colors.
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF'
}

function channels(color: string): number[] {
  if (/^#[\da-f]{3}$/i.test(color)) {
    return [...color.slice(1)].map(value => parseInt(value + value, 16))
  }
  if (/^#[\da-f]{6}$/i.test(color)) {
    return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i.exec(color)
  if (rgb) return rgb.slice(1, 4).map(Number)
  // Chart colors are normalized hex or computed RGB; retain light ink for unknown fills.
  return [0, 0, 0]
}
