# Stored data migrates forward

Status: Accepted (2026-09-28, Canopi v2)

## Context

ADR 0003 refused every older stored format: Designs, the Desktop user database, the LiDAR library and Web storage. It kept the load path simple, but the cost landed on users and on the work itself. Anyone upgrading from Canopi 1.x loses access to their Designs; two v2 preview bumps (v8, v9) invalidated files and saved stamps; and the Recent Designs summaries had to be routed around the user database because any schema change would have set it aside, with the user's favourites and stamps. The user judged the rule to be holding the project back.

## Decision

- **Designs (`.canopi`).** The reader accepts format v5 (Canopi 1.2) up to the current version and upgrades in memory through one pure step per version, in `common-types/src/migrations.rs` and its Web mirror `app/contracts/design-migrations.ts`. Each step has a unit test and a corpus fixture ("accepted with migrated output", run on both trust boundaries). Versions before v5 and versions newer than the app are refused with `unsupported_version`; the native load error is typed (`DesignLoadFailure { kind, message }`, no paths), so an old file reads as "older version", never as "invalid".
- **A Design without a site is interactive.** v5 and v6 Designs hold local metres. A v5 file with a `location`, or a v6 file with a confirmed frame, projects purely through the frame Canopi 1.2 used (location as origin, `north_bearing_deg`). One without a site stops at v6 (`DesignLoadOutcome::NeedsSite`); the app asks "Where is your site?", `place_design_at_site` centres the objects on the chosen point and runs the rest of the ladder. Until the user picks, nothing is written.
- **Saving after a migration.** A migrated Design is not rewritten for having been opened; the first save the user's edits cause writes the current format, and the title bar may say so once (`upgradedFormatWritten`). Recent Designs preview migrated files; a pending one shows counts without ground.
- **Admission after the ladder.** Ids of zones, annotations and groups are unique and non-empty; a plant or measurement guide without an id gets one (Canopi 1.x wrote none); opacities, scales, font sizes and the LiDAR section are range-checked. The pre-map `base` and `contours` layers are dropped at v7.
- **Desktop user DB.** Schema changes are additive, versioned migrations run inside one transaction on open. The database is never set aside; a failed migration leaves the old file untouched and reports.
- **LiDAR library.** A catalogue from an older version is rebuilt from the content-addressed originals it keeps; derived items are recomputed on demand. A newer catalogue is refused.
- **Web storage.** Same rule as Designs; browser-local data upgrades in memory.
- **Settings.** New fields have defaults; values are never rewritten.
- **Boundaries.** Migration code lives in one module per store (`common-types` for Designs, `desktop/src/db/user_db_migrations.rs` for the user DB) and nowhere else; the runtime, codec and UI see only the current format. Old-format code paths outside those modules are still forbidden.

## Consequences

- ADR 0003 is superseded. Its "delete, don't deprecate" rule for dead compatibility code still applies to everything outside the migration modules.
- Until the migrations ship (bead canopi-v2mg), development builds keep refusing older data as before; the release notes for v2.0.0 must state which versions open.
- A format change now costs a migration step with fixtures instead of a user-facing break. That is the intended pressure: change formats rarely, additively where possible.
- The one-off conversion scripts under `.rq-scratch/converted/` become unnecessary and are not maintained.
- Amended 2026-09-28 when the `.canopi` ladder shipped: the interactive step is per site, not per version (a located v5 Design opens without a prompt; an unplaced v6 one asks), and the ladder pauses at v6 rather than carrying a positionless document.
