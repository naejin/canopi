/** What tells a Recent Design apart from others with the same name. */
export type RecentDesignLocation =
  | { readonly kind: 'file'; readonly text: string }
  | { readonly kind: 'folder'; readonly text: string }

export interface RecentDesignLocationInput {
  /** The name as the row shows it. */
  readonly name: string
  /** The file's path; absent where an edition keeps no files. */
  readonly path?: string
}

/**
 * For each row, `null` when no other row shows the same name (ignoring case and
 * surrounding spaces); otherwise its file name when that is its own, or the
 * shortest trailing folder path that is its own among the rows sharing the file
 * name. Paths from either platform's separators are understood.
 */
export function recentDesignLocations(rows: readonly RecentDesignLocationInput[]): (RecentDesignLocation | null)[] {
  const parsed = rows.map((row) => ({ key: nameKey(row.name), path: row.path ? splitPath(row.path) : null }))
  return parsed.map((row, index) => {
    if (!row.path) return null
    const namesakes = parsed.filter((other, otherIndex) => otherIndex !== index && other.key === row.key && other.path)
    if (namesakes.length === 0) return null
    const file = row.path.segments.at(-1) ?? ''
    const sameFile = namesakes.filter((other) => other.path!.segments.at(-1) === file)
    if (sameFile.length === 0) return { kind: 'file', text: file }
    const folders = row.path.segments.slice(0, -1)
    for (let depth = 1; depth <= folders.length; depth += 1) {
      const suffix = folders.slice(-depth).join('/')
      if (sameFile.every((other) => other.path!.segments.slice(0, -1).slice(-depth).join('/') !== suffix)) {
        return { kind: 'folder', text: folders.slice(-depth).join(row.path.separator) }
      }
    }
    return { kind: 'folder', text: folders.join(row.path.separator) }
  })
}

function nameKey(name: string): string {
  return name.normalize('NFC').trim().toLocaleLowerCase()
}

function splitPath(path: string): { segments: string[]; separator: string } {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  return { segments: path.split(/[\\/]+/).filter(Boolean), separator }
}
