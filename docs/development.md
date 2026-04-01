# Development

## Desktop Dev Command

Use `cargo tauri dev` to run the desktop app in development.

Do not use `cargo run dev` for this. In this workspace, `cargo run dev` runs the desktop binary and passes `dev` as an application argument; it does not start the Tauri dev workflow.

## Frontend Hook Location

The frontend app lives in `desktop/web`.

Tauri dev and build hooks are configured in `desktop/tauri.conf.json` to run from that directory:

- `beforeDevCommand`: `npm run dev`
- `beforeBuildCommand`: `npm run build`
- hook `cwd`: `web`

This matters because the repository root also has a `package.json`, but it does not define the frontend `dev` or `build` scripts.

## Common Local Commands

```bash
# Desktop app with Tauri + frontend dev server
cargo tauri dev

# Frontend only
npm run dev --prefix desktop/web

# Frontend checks
npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json
npm test --prefix desktop/web
npm run build --prefix desktop/web
```
