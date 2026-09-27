/** The interface language's own name ("English", "français"), or its code without Intl support. */
export function interfaceLanguageName(locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}
