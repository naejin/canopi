"""Check that a packaged Windows executable carries the Common Controls v6 manifest.

The Tauri dialog plugin calls TaskDialogIndirect, which exists only in Common
Controls v6; an executable whose manifest does not select it fails to start
with STATUS_ENTRYPOINT_NOT_FOUND. desktop/build.rs embeds the manifest through
the MSVC linker, so this guards that the shipped binary still has it.

Usage: python scripts/check_windows_manifest.py path/to/canopi-desktop.exe
"""

import sys

RT_MANIFEST = 24
COMMON_CONTROLS = b"Microsoft.Windows.Common-Controls"


def manifests(path: str) -> list[bytes]:
    import pefile

    pe = pefile.PE(path, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
    )
    found: list[bytes] = []
    resources = getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None)
    for kind in resources.entries if resources else []:
        if kind.id != RT_MANIFEST:
            continue
        for name in kind.directory.entries:
            for language in name.directory.entries:
                data = language.data.struct
                found.append(pe.get_data(data.OffsetToData, data.Size))
    return found


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    found = manifests(argv[1])
    if not found:
        print(f"{argv[1]}: no application manifest", file=sys.stderr)
        return 1
    if not any(COMMON_CONTROLS in manifest for manifest in found):
        print(f"{argv[1]}: the manifest does not select Common Controls v6", file=sys.stderr)
        return 1
    print(f"{argv[1]}: {len(found)} manifest(s), Common Controls v6 selected")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
