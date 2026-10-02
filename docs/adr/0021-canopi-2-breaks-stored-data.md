# Canopi 2.0 breaks stored data

Status: Accepted (2026-10-02, Canopi 2.0)

## Context

ADR 0013 kept a migration ladder: `.canopi` files from v7 and user databases from schema 8 were upgraded on open, with a Web mirror of every step, corpus fixtures on both trust boundaries, a one-off "Saved as Canopi 2 format" notice and an in-memory upgrade for saved stamps. Every format change cost a step in two languages.

Canopi has two users, and the maintainer converts their `.canopi` files by hand. The user decided (2026-10-02): "Don't worry about migrations. This is a breaking release. You can drop all file migration code except the error message saying old versions are not supported by canopi v2.0 and onward." For local data they chose to move old data aside rather than refuse it or delete it. The same day they widened it: "You can modify the .canopi files or the user local data if it's necessary to improve our project. But don't change the plant database."

## Decision

- **Designs (`.canopi`).** Only `CURRENT_CANOPI_FILE_VERSION` (9) opens, on both trust boundaries. Versions 1 to 8, and a missing version, fail with `unsupported_version` and the typed kind `OlderVersion`, which reads "Made with Canopi before 2.0; Canopi 2.0 and later can’t open it"; a newer version reads as newer. The file is never changed. There is no ladder, no converter and no code that reads an older format.
- **Admission stays.** Current-format checks are not migration: obsolete root keys are refused, ids are checked and a plant or guide without one gets one, and ranges are checked. They also catch mistakes in hand-converted files.
- **Local data moves aside, never deleted, never upgraded.** Canopi 2.0 then starts fresh and says so once (Desktop: one dismissible line in the app banner on the start that moved data; Web: a shell notice).
  - Desktop user database (Favorites, Recent Designs, Design notebook, saved stamps, settings): schema 1 to 8, or tables without a version, is renamed `<file>.before-2.0-<unix-seconds>` with its journal files. A newer schema is refused untouched; a damaged file is renamed `<file>.corrupt-<unix-seconds>`.
  - Desktop Drafts in an older format move to `drafts.before-2.0-<unix-seconds>/`; the retired 1.x autosave store moves to `autosave.before-2.0-<unix-seconds>`. Nothing moves when the user database is refused.
  - LiDAR library: an older or damaged catalogue is set aside under `lidar-library.set-aside/` and rebuilt from the originals it keeps (recovery, not migration); a newer one is refused.
  - Web: the 1.x record and older-format Drafts are copied to `canopi:web-app-data:before-2.0-<UTC yyyymmddThhmmssZ>:<key>`, read back, and only then removed, at startup only. When the copy does not fit the storage quota, the data stays in place, hidden, the user is told once that it was kept, and it moves on a later start once there is room.
  - No backup ever overwrites another; a taken name gets `-1`, `-2`…
- **Saved stamps.** Only payload version 2 is read.
- **Settings.** New fields have defaults; an unreadable record is set aside under `settings.set-aside`. That is not a migration and stays.
- **Later format changes.** The `.canopi` format and local data (user database, Drafts, Web storage, LiDAR catalogue, settings) may change when that improves the project, without asking the user first; each change is named in the handoff. Before 2.0 ships, a change moves the current version and older files are refused as above. After 2.0, each format change decides, case by case, between refusing older files (local data moved aside, as above) and a migration; there is no ladder by default. The plant catalog database (`canopi-core.db`) never changes.

## Consequences

- Supersedes [ADR 0013](0013-stored-data-migrations.md). "Delete, don't deprecate" now covers all older-format code: `common-types/src/migrations.rs`, its Web mirror, `user_db_migrations.rs`, their fixtures and the upgrade notice are gone.
- Designs from the 2.0 previews (v7, v8) and Canopi 1.x are refused; the maintainer converts them by hand. Moved-aside local data can be restored by renaming it back for an older Canopi.
- A version 1 stamp payload saved in a current (schema 9) database is kept but can no longer be placed; nothing moves it aside.
- Desktop backup names carry Unix seconds, Web backup keys a UTC date and time.
