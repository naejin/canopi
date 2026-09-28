# Stored data migrates forward

Status: Accepted (2026-09-28, Canopi v2)

## Context

ADR 0003 refused every older stored format: Designs, the Desktop user database, the LiDAR library and Web storage. It kept the load path simple, but the cost landed on users and on the work itself. Anyone upgrading from Canopi 1.x loses access to their Designs; two v2 preview bumps (v8, v9) invalidated files and saved stamps; and the Recent Designs summaries had to be routed around the user database because any schema change would have set it aside, with the user's favourites and stamps. The user judged the rule to be holding the project back.

## Decision

- **Designs (`.canopi`).** The reader accepts format v5 (Canopi 1.2) up to the current version and upgrades in memory through one pure migration step per version (v5→v6→…). Each step has a fixture in the conformance corpus and a round-trip test; the migrated Design is saved in the current format on the next save. Versions before v5 and versions newer than the app are refused with `unsupported_version`.
- **v5 is interactive.** v5 Designs predate geolocation, so opening one asks "Where is your site?" and places the objects on the chosen site; until the user picks, nothing is written.
- **Desktop user DB.** Schema changes are additive, versioned migrations run inside one transaction on open. The database is never set aside; a failed migration leaves the old file untouched and reports.
- **LiDAR library.** A catalogue from an older version is rebuilt from the content-addressed originals it keeps; derived items are recomputed on demand. A newer catalogue is refused.
- **Web storage.** Same rule as Designs; browser-local data upgrades in memory.
- **Settings.** New fields have defaults; values are never rewritten.
- **Boundaries.** Migration code lives in one module per store (`common-types` for Designs, `desktop/src/db/migrations` for the user DB) and nowhere else; the runtime, codec and UI see only the current format. Old-format code paths outside those modules are still forbidden.

## Consequences

- ADR 0003 is superseded. Its "delete, don't deprecate" rule for dead compatibility code still applies to everything outside the migration modules.
- Until the migrations ship (bead canopi-v2mg), development builds keep refusing older data as before; the release notes for v2.0.0 must state which versions open.
- A format change now costs a migration step with fixtures instead of a user-facing break. That is the intended pressure: change formats rarely, additively where possible.
- The one-off conversion scripts under `.rq-scratch/converted/` become unnecessary and are not maintained.
