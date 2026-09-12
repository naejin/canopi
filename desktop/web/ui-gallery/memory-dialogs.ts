// Exercise the real import/export workflow without opening OS dialogs or files.
export async function open() { return 'gallery-example.canopi' }
export async function save() { return 'gallery-export.canopi' }
export async function message(text: string) { console.info('Gallery message:', text) }
