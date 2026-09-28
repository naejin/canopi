# Stored data migrates forward

Status: Accepted (2026-09-28, Canopi v2)

## Context

ADR 0003 refused every older stored format: Designs, the Desktop user database, the LiDAR library and Web storage. It kept the load path simple, but the cost landed on users and on the work itself. Anyone upgrading from Canopi 1.x loses access to their Designs; two v2 preview bumps (v8, v9) invalidated files and saved stamps; and the Recent Designs summaries had to be routed around the user database because any schema change would have set it aside, with the user's favourites and stamps. The user judged the rule to be holding the project back.

## Decision

- **Designs (`.canopi`).** The reader accepts format v7 (the first Canopi 2 preview, `MINIMUM_SUPPORTED_CANOPI_FILE_VERSION`) up to the current version and upgrades in memory through one pure step per version, in `common-types/src/migrations.rs` and its Web mirror `app/contracts/design-migrations.ts`. Each step has a unit test and a corpus fixture run on both trust boundaries.
- **Refusal is typed.** Canopi 1.2 and earlier (v6 and below) and versions newer than the app fail with `unsupported_version`; the native error is `DesignLoadFailure { kind, message }` (no paths), so an old file reads as "made by an older Canopi", never as "invalid".
- **Saving after a migration.** A migrated Design is not rewritten for having been opened; the first save the user's edits cause writes the current format, and the title bar may say so once (`upgradedFormatWritten`). Recent Designs preview migrated files.
- **Admission after the ladder.** Ids of zones, annotations and groups are unique and non-empty; a plant or measurement guide without an id gets one; opacities, scales, font sizes and the LiDAR section are range-checked.
- **Desktop user DB.** Schema changes are additive, versioned migrations in `desktop/src/db/user_db_migrations.rs`, run inside one transaction on open, from schema 8 (Canopi 1.0 to 1.2) upwards. A failed migration leaves the old file untouched and reports; an older or newer schema is refused untouched with a typed error; only a damaged file is renamed `<file>.corrupt-<unix-seconds>` and replaced.
- **LiDAR library.** A catalogue from an older version is set aside and rebuilt from the content-addressed originals it keeps; derived items are recomputed on demand. A newer catalogue is refused.
- **Web storage.** Same rule as Designs; browser-local data upgrades in memory. Not built: until its migration ships, records from an older Canopi are ignored.
- **Settings.** New fields have defaults; values are never rewritten. An unreadable record is set aside under `settings.set-aside` and replaced by defaults.
- **Boundaries.** Migration code lives in one module per store (`common-types` for Designs, `user_db_migrations.rs` for the user DB) and nowhere else; the runtime, codec and UI see only the current format. Old-format code paths outside those modules are still forbidden.

## Consequences

- ADR 0003 is superseded. Its "delete, don't deprecate" rule for dead compatibility code still applies to everything outside the migration modules.
- A format change now costs a migration step with fixtures instead of a user-facing break. That is the intended pressure: change formats rarely, additively where possible.
- The one-off conversion scripts under `.rq-scratch/converted/` became unnecessary and are not maintained.
- History: accepted with a v5 floor (Canopi 1.2) and an interactive "Where is your site?" step for Designs without a site. Amended 2026-09-28 by user decision ("support back to v7 is enough; otherwise display an error message"): the `.canopi` ladder starts at v7 and the user-DB ladder at schema 8; the v5→v7 steps, the Canopi 1.2 frame projection, the interactive site step and user-DB steps 2→8 were deleted.
