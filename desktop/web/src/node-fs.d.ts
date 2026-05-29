declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean
  export function readFileSync(path: string | URL, encoding: string): string
}
