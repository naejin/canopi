# Document lifecycle

Use this routing guide for Design Session ownership, replacement, save/load, dirty state, document format, or settings. SceneStore owns canvas content; Design Edit owns non-canvas edits; persistence composes their committed snapshots.

| Change | Read |
| --- | --- |
| Mount, resources, edition host ordering | [Session ownership](document-session.md) |
| Non-canvas edits, previews, document history | [Design Edit](document-edits.md) |
| Open/New, replacement guards, teardown and retry | [Replacement](document-replacement.md) |
| Save, autosave, write ordering, acknowledgement | [Persistence](document-persistence.md) |
| Fields, ingestion, serialization, derived exports (PDF, GeoJSON) | [Format](document-format.md) |
| Preferences, bootstrap, flush, platform adapters | [Settings](settings.md) |

The headings below preserve incoming links. Read only the destinations relevant to the task.

## Current Boundaries

See [Design Session ownership](document-session.md#current-boundaries).

## Canvas host lifecycle assessment

See [Design Session ownership](document-session.md#canvas-host-lifecycle-assessment).

## Tauri Lifecycle Gotchas

See [Design Session ownership](document-session.md#tauri-lifecycle-gotchas).

## Document Authority

See [Design Edit and document authority](document-edits.md#document-authority).

## Dirty State And Autosave

See [Design persistence and dirty state](document-persistence.md#dirty-state-and-autosave).

## Save And Format Contract

See [Design format and export](document-format.md#save-and-format-contract).

## Saved Object Stamp Import And Export

See [Design format and export](document-format.md#saved-object-stamp-import-and-export).

## Export Boundaries

See [Design format and export](document-format.md#export-boundaries).

## GeoJSON Import And Export

See [Design format and export](document-format.md#geojson-import-and-export).

## Adding Document Fields

See [Design format and export](document-format.md#adding-document-fields).

## File Format Admission

See [Design format and export](document-format.md#file-format-admission).

## LiDAR Presentation Section

See [Design format and export](document-format.md#lidar-presentation-section).

## Settings Persistence

See [Settings persistence](settings.md#settings-persistence).

## Document Mutation Rules

See [Design Edit](document-edits.md#document-mutation-rules), [replacement](document-replacement.md#document-mutation-rules), and [persistence](document-persistence.md#document-mutation-rules) for the corresponding ownership boundary.
