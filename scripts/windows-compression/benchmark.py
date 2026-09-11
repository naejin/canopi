"""Rebundle the fixed 1.1.1 Windows payload; never build or publish a release.

Run only on a disposable Windows runner: installer checks write normal per-user
installation registry entries. The workflow supplies a separate source checkout.
"""

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time


SOURCE_SHA = "8af863dfd3ec26ca3973672d0f74ef6a4576cde5"
MSI_SHA = "d699f77bd591315df6a2bd4ee26839af3fe096e74e223ec632cc5ade1928cb7e"
DB_SHA = "76dd7abe3eb1420e1e4b068a69112ba8d90f2a507ee53b4c0028469e6287a51b"
CLI_VERSION = "2.11.4"
TARGET = "x86_64-pc-windows-msvc"
MSI_NAME = "Canopi_1.1.1_x64_en-US.msi"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, *, cwd=None, log=None, timeout=300):
    """Bound external work and retain its output when a command fails."""
    print(f"Running: {args}", flush=True)
    executable = shutil.which(str(args[0]))
    if not executable:
        raise RuntimeError(f"Required command missing: {args[0]}")
    command = [executable, *map(str, args[1:])]
    stream = log.open("w", encoding="utf-8") if log else subprocess.PIPE
    try:
        with subprocess.Popen(command, cwd=cwd, stdout=stream,
                              stderr=subprocess.STDOUT, text=True) as process:
            try:
                stdout, _ = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               check=True, timeout=30)
                raise
            if process.returncode:
                raise RuntimeError(f"Command exited {process.returncode}; see {log or stdout}")
        return log.read_text(encoding="utf-8", errors="replace") if log else stdout
    finally:
        if log:
            stream.close()


def one_file(root, pattern):
    files = list(root.rglob(pattern))
    if len(files) != 1:
        raise RuntimeError(f"Expected one {pattern} in {root}; found {files}")
    return files[0]


def assert_digest(path, expected):
    actual = digest(path)
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch for {path}: {actual} != {expected}")


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def benchmark(source, output, scratch):
    if run(["git", "rev-parse", "HEAD"], cwd=source).strip() != SOURCE_SHA:
        raise RuntimeError("The payload source checkout must match the fixed release commit")
    if run(["git", "status", "--porcelain"], cwd=source).strip():
        raise RuntimeError("Use a clean, disposable source checkout")
    downloads = scratch / "downloads"
    downloads.mkdir()
    run(["gh", "release", "download", "v1.1.1", "--repo", "naejin/canopi",
         "--pattern", MSI_NAME, "--pattern", "release-metadata.json",
         "--pattern", "SHA256SUMS.txt", "--dir", downloads], timeout=600)
    metadata = json.loads((downloads / "release-metadata.json").read_text())
    if (metadata["head_sha"] != SOURCE_SHA or metadata["release_version"] != "1.1.1"
            or metadata["repository"] != "naejin/canopi" or metadata["db_sha256"] != DB_SHA):
        raise RuntimeError("Published metadata no longer matches the benchmark baseline")
    manifest = (downloads / "SHA256SUMS.txt").read_text().splitlines()
    entries = [line.split() for line in manifest if line.endswith("/" + MSI_NAME)]
    if len(entries) != 1 or entries[0][0] != MSI_SHA:
        raise RuntimeError("Published manifest no longer matches the fixed MSI")
    msi = downloads / MSI_NAME
    assert_digest(msi, MSI_SHA)
    extracted = scratch / "msi"
    run(["msiexec", "/a", msi, "/qn", f"TARGETDIR={extracted}",
         "/l*v", output / "msi-extraction.log"], timeout=600)
    executable = one_file(extracted, "*.exe")
    database = one_file(extracted, "canopi-core.db")
    assert_digest(database, DB_SHA)
    exe_sha = digest(executable)
    release_dir = source / "target" / TARGET / "release"
    release_dir.mkdir(parents=True)
    shutil.copy2(executable, release_dir / executable.name)
    resources = source / "desktop" / "resources"
    resources.mkdir(exist_ok=True)
    shutil.copy2(database, resources / "canopi-core.db")
    cli = ["npx", "--yes", f"--package=@tauri-apps/cli@{CLI_VERSION}", "tauri"]
    cli_version = run([*cli, "--version"], cwd=source).strip()
    runner = json.loads(run(["powershell", "-NoProfile", "-Command",
        "@{cpu=(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name); "
        "logical_processors=[Environment]::ProcessorCount; "
        "memory_bytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory} | ConvertTo-Json"]))
    report = {
        "release": "v1.1.1", "source_sha": SOURCE_SHA, "msi_sha256": MSI_SHA,
        "exe_sha256": exe_sha, "db_sha256": DB_SHA,
        "payload_bytes": executable.stat().st_size + database.stat().st_size,
        "tauri_cli": cli_version, "os": platform.platform(), "runner": runner,
        "runner_image": os.environ.get("ImageVersion"),
        "run_url": f"https://github.com/naejin/canopi/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}",
        "timing_scope": "tauri bundle only; excludes setup, compilation, verification and uploads",
        "warmup": "untimed compression=none populates the NSIS tool cache",
        "results": [],
    }
    write_json(output / "report.json", report)
    for compression in ("none", "lzma", "zlib"):
        override = scratch / "compression.json"
        write_json(override, {"bundle": {"windows": {"nsis": {"compression": compression}}}})
        started = time.perf_counter()
        run([*cli, "bundle", "--ci", "--target", TARGET, "--bundles", "nsis",
             "--config", override], cwd=source, log=output / f"bundle-{compression}.log",
            timeout=1800)
        elapsed = time.perf_counter() - started
        installer = one_file(release_dir / "bundle" / "nsis", "*.exe")
        if compression == "none":
            makensis = one_file(Path(os.environ["LOCALAPPDATA"]) / "tauri", "makensis.exe")
            report["nsis_version"] = run([makensis, "/VERSION"]).strip()
            write_json(output / "report.json", report)
            installer.unlink()
            continue
        # Only the compressor changes. Retain the generated script as evidence.
        generated = one_file(release_dir / "nsis", "installer.nsi")
        shutil.copy2(generated, output / f"installer-{compression}.nsi")
        result = {"compressor": compression, "elapsed_seconds": round(elapsed, 3),
                  "installer_bytes": installer.stat().st_size,
                  "installer_sha256": digest(installer), "payload_verified": False,
                  "startup_verified": False}
        report["results"].append(result)
        write_json(output / "report.json", report)
        install_dir = scratch / f"installed-{compression}"
        run([installer, "/S", "/NS", f"/D={install_dir}"],
            log=output / f"install-{compression}.log", timeout=600)
        try:
            installed_exe = install_dir / executable.name
            installed_db = install_dir / "resources" / "canopi-core.db"
            assert_digest(installed_exe, exe_sha)
            assert_digest(installed_db, DB_SHA)
            result["payload_verified"] = True
            run(["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
                 Path(__file__).with_name("smoke.ps1"), "-Executable", installed_exe,
                 "-Evidence", output / compression],
                log=output / f"smoke-{compression}.log", timeout=180)
            result["startup_verified"] = True
        finally:
            write_json(output / "report.json", report)
            uninstaller = install_dir / "uninstall.exe"
            if uninstaller.exists():
                run([uninstaller, "/S", f"_?={install_dir}"], timeout=120)
        installer.unlink()
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    if sys.platform != "win32" or os.environ.get("GITHUB_ACTIONS") != "true":
        sys.exit("This installer benchmark requires a disposable GitHub Windows runner")
    source, output = map(lambda value: Path(value).resolve(), sys.argv[1:])
    output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="canopi-compression-") as temporary:
        benchmark(source, output, Path(temporary))
