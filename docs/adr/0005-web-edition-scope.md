# Web Edition scope

Status: Accepted (2026-09-25, Canopi v2)

## Context

The Web Edition is a browser build of the real Canopi app. It must stay deployable as static files without a backend while sharing the Design format, codec, runtime and workbenches with Desktop.

## Decision

- **Static app.** The Canopi repository builds a versioned static artifact with a manifest (app version, commit, base path, asset inventory, SHA-256 checksums). Website repositories publish that artifact and never import app source. The production host is `web.projectcanopi.com` (root base); a `/app/` subpath artifact stays supported. No backend, tile proxy, service worker, PWA install or offline-first cache.
- **Real Designs.** Web creates, opens, edits and downloads real `.canopi` files through the normal Design Session seams. The only Design save format is a `.canopi` download; Canvas PDF and GeoJSON are derived exports. There are no other export formats.
- **Browser-local data.** Design Drafts (the home of every Web Design, saved continuously per [ADR 0009](0009-continuous-save.md) and listed on the welcome screen), settings, species favourites and activity, and saved object stamps live in independent browser-local records. No accounts or sync. Clearing site data loses them; a downloaded `.canopi` file is the portable copy.
- **Geocoding allowed.** Web uses the shared geocoding provider registry from the browser: Nominatim first, search on Enter only, at least 1.1 s between requests, OSM attribution on results. Coordinates are parsed locally without a request. No proxy.
- **Maps.** Web shows the same basemap and Google satellite imagery as Desktop, with their attribution. Google uses its public tiles without a key and the official Map Tiles API with the user's own device key. No bundled tile pyramids, bulk download or offline archive. No local raster processing in Web.
- **No problem reports.** Web omits the Desktop Problem Report flow and Diagnostic Bundles. Desktop keeps local Diagnostic Bundles that the user chooses how to share; nothing uploads automatically.
- **Shell.** A browser app shell (New, Open `.canopi`, Download `.canopi`, exports, language, theme, panels) wraps the shared workspace composition. It shows no native window controls, Recent Design paths, reveal actions, Design Notebook or updater.
- **Compile-time adapters.** Desktop and Web choose platform adapters through separate build entries and aliases. Build checks reject Tauri and other desktop imports in Web chunks.
- **Templates.** Web imports only Design Templates shipped as static assets; with none configured, the template map is hidden.

## Consequences

- One codec and runtime serve both editions, so format support cannot drift.
- Web has no durable storage beyond browser records and downloaded files.
- Third-party tile and geocoding outages remove only that background or search; editing continues.
- The Web build boundary check enforces this scope and must not be weakened.
