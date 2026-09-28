# No backward compatibility in Canopi v2

Status: Superseded (2026-09-28)
superseded_by: 0013-stored-data-migrations.md

## Context

Canopi v1 accumulated migrations, legacy readers, compatibility corpora and preserved historical storage for Designs, the user database, Web storage and the LiDAR library. Each one had to be tested and kept consistent across two editions. The v2 geolocated format changes every stored position, so carrying old formats forward would mean a permanent converter on the load path.

## Decision

- Canopi v2 has no migrations, legacy readers, compatibility shims or old-format fixtures. Old data is refused, set aside or deleted.
- **Designs:** only the current `.canopi` format is admitted (v7 when this was accepted; v8 since saved views and stories, ADR 0011; v9 since a zone's display name is separate from its id and the LiDAR entry kind `Analysis` became `Derived`). Older, missing, invalid and future versions are refused with the existing `unsupported_version` error before the active Design is replaced. There is no production converter; a test may convert a fixture through a test-only helper.
- **Desktop user DB:** one schema. A database from an older Canopi is renamed `user.db.v<N>-set-aside` and an empty one is created.
- **LiDAR library:** catalogue v20. A library written by an older Canopi is deleted on first open and starts empty; a newer catalogue is refused, not deleted.
- **Web storage:** v1 browser storage is ignored, never read or rewritten.
- **Settings:** no value rewriting (for example, no "system" theme conversion).
- Superseded by [ADR 0013](0013-stored-data-migrations.md): stored data migrates forward. Until those migrations ship, this refusal behaviour is what the code does.

## Consequences

- Users must keep a v1 install to open v1 Designs; release notes state the break.
- The load path has one format per store, so the codec, ingestion and conformance corpus test only current data.
- Deleting or setting aside old data is visible in release notes; the Desktop user DB is renamed rather than deleted so a user can recover it manually.
- Dead compatibility code, tests and docs are deleted in the change that makes them dead.
