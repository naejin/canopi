# Web Edition omits Problem Report in v1

Status: Accepted

The Web Edition v1 does not expose the desktop Problem Report flow, Diagnostic Bundle generation, native report-folder creation, or folder reveal behavior. The desktop app keeps the local-first Problem Report feature.

The desktop Problem Report implementation depends on native filesystem access, local app/log directories, ZIP generation into a user-visible folder, and OS folder reveal APIs. Those behaviors do not map cleanly to a static Cloudflare Pages web app without either weakening the support artifact or adding backend submission/storage. Web v1 should avoid both.

A later web-specific support flow may provide a browser-only copyable support summary, but it should be designed separately and must not imply backend upload, diagnostic bundle collection, or native folder access.
