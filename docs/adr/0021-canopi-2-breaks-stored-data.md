# Canopi 2.0 breaks stored data

Status: Accepted (2026-10-02, Canopi 2.0); amended 2026-10-03 and 2026-10-05 (U33: older local data stays in place; no backward compatibility before 2.0 ships)

## Context

ADR 0013 kept a migration ladder: `.canopi` files from v7 and user databases from schema 8 were upgraded on open, with a Web mirror of every step, corpus fixtures on both trust boundaries, a one-off "Saved as Canopi 2 format" notice and an in-memory upgrade for saved stamps. Every format change cost a step in two languages.

Canopi has two users, and the maintainer converts their `.canopi` files by hand. The user decided (2026-10-02): "Don't worry about migrations. This is a breaking release. You can drop all file migration code except the error message saying old versions are not supported by canopi v2.0 and onward." For local data they chose to move old data aside rather than refuse it or delete it (replaced by U33). The same day they widened it: "You can modify the .canopi files or the user local data if it's necessary to improve our project. But don't change the plant database."

## Decision

- **Designs (`.canopi`).** Only `CURRENT_CANOPI_FILE_VERSION` (9) opens, on both trust boundaries. Versions 1 to 8, and a missing version, fail with `unsupported_version` and the typed kind `OlderVersion`, which reads "Made with Canopi before 2.0; Canopi 2.0 and later can’t open it"; a newer version reads as newer. The file is never changed. There is no ladder, no converter and no code that reads an older format.
- **Admission stays.** Current-format checks are not migration: obsolete root keys are refused until the two users' files are converted (then that check goes, U33), ids are checked and a plant or guide without one gets one, and ranges are checked. They also catch mistakes in hand-converted files.
- **Older local data stays in place, never read, never deleted, never upgraded** (user, 2026-10-05, U33, replacing the dated move-aside of 2026-10-02, whose backup naming, read-back checks, rollback and quota fallback cost about 300 lines for data only development builds and 1.x hold). Canopi 2.0 starts fresh and says once that older data can't be opened.
  - Desktop user database (Favorites, Recent Designs, Design notebook, saved stamps, settings): schema 1 to 8, or tables without a version, is renamed `<file>.before-2.0-<unix-seconds>` with its journal files, since 2.0 needs that path. A newer schema is refused untouched; a damaged file is renamed `<file>.corrupt-<unix-seconds>`.
  - Desktop Drafts in an older format and the retired 1.x autosave store stay where they are, unread.
  - LiDAR library: an older or damaged catalogue is set aside under `lidar-library.set-aside/` and rebuilt from the originals it keeps (recovery, not migration); a newer one is refused.
  - Web: the 1.x record and older-format Drafts stay under their keys, unread, so 1.x Web still opens them.
- **Saved stamps.** Only payload version 2 is read.
- **Settings.** New fields have defaults; an unreadable record is set aside under `settings.set-aside`. That is not a migration and stays.
- **Additive `.canopi` changes** (amended 2026-10-03 with U21, whose camera-zoom fallback for a view without the ground size U33 replaced on 2026-10-05: the field is required). An optional additive field, or the removal of a field nothing reads, does not move the version: admission has no `deny_unknown_fields` and the schema allows extra properties, so files on either side of the change still open.
- **No backward compatibility before 2.0 ships** (user, 2026-10-05, U33): "we should not waste any time and energy on backward compatibility". No fallback reads an older shape and no test covers a version that never shipped; a field only development files lack may become required at version 9.
- **Later format changes.** The `.canopi` format and local data (user database, Drafts, Web storage, LiDAR catalogue, settings) may change when that improves the project, without asking the user first; each change is named in the handoff. Before 2.0 ships, any other change moves the current version and older files are refused as above. After 2.0, each format change decides, case by case, between refusing older files (local data moved aside, as above) and a migration; there is no ladder by default. The plant catalog database (`canopi-core.db`) never changes.

## Consequences

- Supersedes [ADR 0013](0013-stored-data-migrations.md). "Delete, don't deprecate" now covers all older-format code: `common-types/src/migrations.rs`, its Web mirror, `user_db_migrations.rs`, their fixtures and the upgrade notice are gone.
- Designs from the 2.0 previews (v7, v8) and Canopi 1.x are refused; the maintainer converts them by hand. Older local data left in place still opens in an older Canopi; the renamed user database can be renamed back.
- A version 1 stamp payload saved in a current (schema 9) database is kept but can no longer be placed; nothing moves it aside.
- The renamed Desktop user database carries Unix seconds in its name.
