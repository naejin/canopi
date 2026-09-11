# Windows installer compression benchmark

The `Windows compression benchmark` workflow measures NSIS LZMA and zlib using
the exact released Canopi 1.1.1 executable and database. It does not rebuild the
application, publish assets, or change production compression. Run it manually
with `gh workflow run windows-compression-benchmark.yml` after merging the harness.
Changes to the harness also run it on pull requests.

The workflow uses a separate checkout of the release commit and downloads the
published MSI, manifest, and release metadata. The harness checks the fixed MSI
and database SHA-256 values and the source identity before administratively
extracting the MSI. It pins Tauri CLI 2.11.4, matching the release job, and runs
`tauri bundle` against the extracted executable and database. No frontend or Rust
compilation enters the measured interval.

An untimed `compression=none` bundle prepares the NSIS tools. LZMA and zlib then
run sequentially on the same Windows runner. Timings include the Tauri bundling
command, excluding downloads, hashing, installation, startup verification, and
artifact upload. The report records the runner image, CPU, memory, tool versions,
input hashes, elapsed seconds, installer sizes, and output hashes. A single pair
is a directional comparison, not a statistical confidence interval.

Each installer is silently installed into a separate temporary directory. Both
installed application and database hashes must match the released payload. The
startup probe requires the rendered **New Design** and **Open Design** welcome
actions in Windows UI Automation, captures a screenshot, and terminates its own
application process tree. This is startup coverage, not a replacement for the
full release smoke checklist. The installer is then uninstalled. Run this harness
only on a disposable GitHub Windows runner: it writes ordinary installation
registry entries and application settings.

The `windows-compression-evidence` artifact retains the JSON report, generated
NSIS scripts, command logs, accessibility output, and screenshots for 30 days.
Installers and temporary extracted payloads are discarded; released installers
remain unchanged. Record reviewed measurements and the policy recommendation
here before closing the benchmark bead.

References: [Tauri bundle CLI](https://v2.tauri.app/reference/cli/#bundle),
[Tauri NSIS compression options](https://v2.tauri.app/reference/config/#nsiscompression),
[NSIS SetCompressor](https://nsis.sourceforge.io/Reference/SetCompressor),
[Windows administrative installation](https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation).
