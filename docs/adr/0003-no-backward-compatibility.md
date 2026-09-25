# No backward compatibility in Canopi v2

Status: Accepted (2026-09-25, Canopi v2)

## Context

Canopi v1 accumulated migrations, legacy readers, compatibility corpora and preserved historical storage for Designs, the user database, Web storage and the LiDAR library. Each one had to be tested and kept consistent across two editions. The v2 geolocated format changes every stored position, so carrying old formats forward would mean a permanent converter on the load path.

## Decision

- Canopi v2 has no migrations, legacy readers, compatibility shims or old-format fixtures. Old data is refused, set aside or deleted.
- **Designs:** only `.canopi` format v7 is admitted. v6 and older, missing, invalid and future versions are refused with the existing `unsupported_version` error before the active Design is replaced. There is no production converter; a test may convert a fixture through a test-only helper.
- **Desktop user DB:** one schema. A database from an older Canopi is renamed `user.db.v<N>-set-aside` and an empty one is created.
- **LiDAR library:** catalogue v20. A library written by an older Canopi is deleted on first open and starts empty; a newer catalogue is refused, not deleted.
- **Web storage:** v1 browser storage is ignored, never read or rewritten.
- **Settings:** no value rewriting (for example, no "system" theme conversion).
- A future format change bumps the version and refuses the previous one, unless a new ADR decides otherwise.

## Consequences

- Users must keep a v1 install to open v1 Designs; release notes state the break.
- The load path has one format per store, so the codec, ingestion and conformance corpus test only current data.
- Deleting or setting aside old data is visible in release notes; the Desktop user DB is renamed rather than deleted so a user can recover it manually.
- Dead compatibility code, tests and docs are deleted in the change that makes them dead.
