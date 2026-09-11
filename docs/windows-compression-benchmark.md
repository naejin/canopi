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
remain unchanged. The reviewed measurements and policy recommendation below
retain the outcome after the workflow artifacts expire.

References: [Tauri bundle CLI](https://v2.tauri.app/reference/cli/#bundle),
[Tauri NSIS compression options](https://v2.tauri.app/reference/config/#nsiscompression),
[NSIS SetCompressor](https://nsis.sourceforge.io/Reference/SetCompressor),
[Windows administrative installation](https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation).

## Reviewed measurements — 2026-09-12

[Run 34655208968](https://github.com/naejin/canopi/actions/runs/34655208968)
passed both installed-payload and rendered-startup checks. Both screenshots were
also visually reviewed: the expected Canopi welcome screen rendered identically.
Comparing the generated NSIS scripts found only the compressor substitutions.
The complete machine-readable report is retained in
[`evidence/windows-compression-1.1.1.json`](evidence/windows-compression-1.1.1.json).

| NSIS compressor | Bundle time | Installer bytes | Decimal MB | Payload and startup |
| --- | ---: | ---: | ---: | --- |
| LZMA | 673.329 s (11m 13s) | 292,547,303 | 292.55 | Passed |
| zlib | 165.467 s (2m 45s) | 456,091,697 | 456.09 | Passed |

The runner was Windows Server 2025, image `20260907.229.1`, with four logical
processors on an AMD EPYC 7763 and approximately 16 GiB RAM. Tools were Tauri CLI
2.11.4 and NSIS 3.11. The identical application/database payload was
1,296,261,120 bytes. Both installed executables matched SHA-256
`b235d284e737fb9acf0efb11701b6452ce7b00b6d25b13134adcf7f89c37f4af`;
both installed databases matched
`76dd7abe3eb1420e1e4b068a69112ba8d90f2a507ee53b4c0028469e6287a51b`.

zlib saved **507.862 seconds (8m 28s), or 75.4% of the NSIS bundling time**, while
adding **163,544,394 bytes (55.9%)** to the installer. This is a one-pair bundling
comparison, not an end-to-end CI speedup: compilation, MSI creation and the larger
artifact upload still contribute to the full job. As an illustrative download
cost, those extra bytes alone take about 65 seconds at 20 Mbit/s, excluding
protocol overhead; actual user connections vary.

### Recommended policy

Keep **LZMA for public release candidates**: the smaller public download is worth
the one-time packaging cost, and promotion reuses the already verified candidate
bytes. Use **zlib for routine Windows Build & Test installers**, subject to a
separate policy review, while retaining MSI and every existing package format.
Release-candidate validation must continue to exercise the public LZMA installer.

Neither workflow policy nor `desktop/tauri.conf.json` changes as part of this
measurement bead. Decision `canopi-todb` tracks review of the proposed split;
an accepted implementation must also measure complete Windows CI duration,
including artifact upload, and preserve packaged verification.
