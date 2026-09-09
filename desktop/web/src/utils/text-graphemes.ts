// Preserve combining marks and joined sequences without requiring Intl.Segmenter.
export function textGraphemes(text: string): string[] {
  const segments: string[] = []
  for (const char of text.normalize('NFC')) {
    const previous = segments[segments.length - 1]
    if (previous !== undefined && (/\p{Mark}|[\u200d\ufe0f]/u.test(char) || previous.endsWith('\u200d'))) segments[segments.length - 1] += char
    else segments.push(char)
  }
  return segments
}
