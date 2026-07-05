const WEB_EDITION_DEV_ENTRY_PATHS = new Set([
  "/app",
  "/app/",
  "/app/index.html",
]);

export function resolveWebEditionDevHtmlUrl(requestUrl: string | undefined): string | null {
  if (!requestUrl) return null;

  const url = new URL(requestUrl, "http://canopi.local");
  if (!WEB_EDITION_DEV_ENTRY_PATHS.has(url.pathname)) return null;

  return `/app/web.html${url.search}`;
}
