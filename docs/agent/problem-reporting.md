# Problem Reporting

Use this guide when changing Problem Report, Report Summary, or Diagnostic Bundle behavior.

## Product Boundary

- Problem Reports are local-first. Do not add automatic upload, telemetry, email drafts, or GitHub issue creation unless a bead explicitly changes the support-channel decision.
- Web Edition v1 does not expose Problem Report, Diagnostic Bundle generation, native report-folder creation, or folder reveal behavior. See `docs/adr/0015-web-edition-omits-problem-report.md`.
- The default Diagnostic Bundle must exclude Design contents, precise Location, screenshots, and raw filesystem paths.
- Current Design contents may be included only through an explicit, off-by-default user consent control. When included, the bundle manifest and Report Summary must identify the sensitive attachment.
- Personal libraries such as Saved Object Stamps are not part of the default Diagnostic Bundle. Do not include them through settings or user DB summaries unless a future explicit, off-by-default consent control names that library.
- The user-facing artifacts are `Report Summary.txt` and `Diagnostic Bundle.zip` in a timestamped `Canopi Problem Report ...` folder. Keep this folder easy for non-technical users to find.
- The success screen can reveal the generated folder through the narrow `show_problem_report_folder` command. Keep validation scoped to generated Problem Report folders and avoid unrestricted shell execution.

## Implementation Seams

- Shared IPC types live in `common-types/src/support.rs`; regenerate frontend bindings when they change.
- Rust Problem Report orchestration belongs in `desktop/src/services/problem_report/mod.rs`; Diagnostic Bundle content assembly, redactions, stored ZIP encoding, and folder reveal validation live in focused sibling modules under `desktop/src/services/problem_report/`.
- The Tauri command should stay thin and only resolve app paths, settings, health, and runtime metadata before calling the service.
- Native folder reveal uses fixed platform commands from Rust (`open`, `explorer`, or `xdg-open`) after service validation; tests should inject the reveal seam instead of launching a file manager.
- Frontend entry points should go through the App Command Graph in `desktop/web/src/commands/registry.ts`; do not wire menu-only problem-report actions.
- Frontend submission state and request assembly live in `desktop/web/src/app/problem-report/submission.ts`. The dialog should render that module's state and call its commands instead of assembling diagnostics, sensitive attachments, clipboard writes, folder reveals, or IPC requests itself.
- Current Design attachments should be built through the document-session persistence seam so canvas-owned and document-owned state are composed the same way as saves.

## UI And Testing

- Follow `.interface-design/system.md`: field-notebook surfaces, ochre primary actions, borders-first depth, no green UI chrome, CSS module tokens for spacing/type/radius.
- Add all user-visible strings to all 11 locale files.
- Test the backend service through observable artifacts and privacy exclusions.
- Test the frontend flow through the public dialog/command behavior, not internal component state.
