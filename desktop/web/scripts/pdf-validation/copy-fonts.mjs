import { cp } from 'node:fs/promises'
await cp(new URL('../../public/pdf-fonts/', import.meta.url), new URL('../../dist-pdf-validation/pdf-fonts/', import.meta.url), { recursive: true })
