import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Text is sized in px tokens, while a rem length follows the browser's default font size: at a large
// browser font a rem flex-basis or max-width outgrows its px-sized row and pushes text under its icon
// or button (canopi-6spu).
function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

it('no stylesheet sizes a layout length in rem (canopi-6spu, root 24 px)', () => {
  const remLengths = cssFiles('src').flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) => (/\d(?:\.\d+)?rem\b/.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
  )
  expect(remLengths).toEqual([])
})
