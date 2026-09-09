declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array
  export function existsSync(path: string | URL): boolean
  export function readFileSync(path: string | URL, encoding: string): string
}
