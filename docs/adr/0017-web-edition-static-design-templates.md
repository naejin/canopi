# Web Edition uses static bundled Design Templates in v1

Status: Accepted

The Web Edition v1 may keep the Community/Design Template world map only for templates shipped as static assets with the Web Edition bundle or another explicitly configured static asset host. Template import fetches a known `.canopi` asset, decodes it at the Web Design ingestion boundary, and routes one owned Design envelope through the normal Design Session template-open flow. Web v1 templates import as-is, without Site Adaptation review, compatibility checks, or replacement suggestions.

The Web Edition must not depend on a native temp-file download command, arbitrary remote template URLs, or backend template download/storage. Keeping templates static preserves the Cloudflare Pages deployment model and makes template size, count, CORS, cache headers, and `.canopi` compatibility part of the web build artifact.

If no static template set is prepared for v1, the Web Edition should hide the Community/Template world map rather than ship a partially functional remote-download surface.
