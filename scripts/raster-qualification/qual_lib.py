#!/usr/bin/env python3
"""Shared primitives for the raster qualification harness (Q).

This module deliberately contains no production code path. It provides:

* a strict TIFF/GeoTIFF layout reader used to compute *exact* byte ranges,
* a bounded window reader that reads only the bytes a window occupies,
* process/host resource samplers used by the capacity experiment,
* a tiny report writer.

Scientific use of these functions is a *reference* implementation: it is written
from the format specification and the analytic fixture definitions, not from the
candidate engine, so agreement between the two is meaningful evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
import resource
import struct
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

TIFF_TYPES = {1: ("B", 1), 2: ("c", 1), 3: ("H", 2), 4: ("I", 4), 5: ("II", 8),
              6: ("b", 1), 7: ("B", 1), 8: ("h", 2), 9: ("i", 4), 10: ("ii", 8),
              11: ("f", 4), 12: ("d", 8), 16: ("Q", 8), 17: ("q", 8), 18: ("Q", 8)}


@dataclass
class TiffLayout:
    """Byte-exact structural description of a TIFF, enough to address windows."""

    path: Path
    size: int
    little_endian: bool
    bigtiff: bool
    width: int
    height: int
    bits_per_sample: int
    sample_format: int
    compression: int
    tiled: bool
    tile_width: int
    tile_height: int
    tiles_across: int
    tiles_down: int
    offsets: list[int]
    byte_counts: list[int]
    nodata: float | None
    geo_transform: list[float] | None
    # Number of stored resolution levels is not needed for level-0 window math.

    @property
    def is_uncompressed(self) -> bool:
        return self.compression == 1

    @property
    def bytes_per_pixel(self) -> int:
        return self.bits_per_sample // 8

    def strip_index(self, x: int, y: int) -> int:
        if self.tiled:
            return (y // self.tile_height) * self.tiles_across + (x // self.tile_width)
        return y // self.tile_height

    def window_byte_ranges(self, x: int, y: int, width: int, height: int) -> list[tuple[int, int]]:
        """Exact byte ranges touched for a level-0 window, in file order.

        Only meaningful for uncompressed data; compressed blocks must be read
        whole. The caller is expected to sum these to prove bounded I/O.
        """
        if not self.is_uncompressed:
            raise ValueError("byte-range window math requires an uncompressed TIFF")
        ranges: list[tuple[int, int]] = []
        x1 = min(x + width, self.width)
        y1 = min(y + height, self.height)
        if x1 <= x or y1 <= y:
            return ranges
        if self.tiled:
            row_block = self.tile_width * self.bytes_per_pixel
            for ty in range(y // self.tile_height, (y1 - 1) // self.tile_height + 1):
                for tx in range(x // self.tile_width, (x1 - 1) // self.tile_width + 1):
                    index = ty * self.tiles_across + tx
                    ranges.append((self.offsets[index], self.byte_counts[index]))
            return ranges
        # Stripped and uncompressed: address exactly the sub-rows required.
        for row in range(y, y1):
            base = self.offsets[row // self.tile_height]
            within = (row % self.tile_height) * self.width * self.bytes_per_pixel
            start = base + within + x * self.bytes_per_pixel
            ranges.append((start, (x1 - x) * self.bytes_per_pixel))
        return ranges


def _read_tag_value(handle, endian: str, field_type: int, count: int, value_bytes: bytes,
                    data_offset: int, bigtiff: bool) -> Any:
    fmt, size = TIFF_TYPES[field_type]
    total = size * count
    inline = 8 if bigtiff else 4
    if total <= inline:
        raw = value_bytes[:total]
    else:
        offset = struct.unpack(endian + ("Q" if bigtiff else "I"), value_bytes[:8 if bigtiff else 4])[0]
        handle.seek(offset)
        raw = handle.read(total)
    values = struct.unpack(endian + fmt * count, raw)
    return values[0] if count == 1 else list(values)


def read_tiff_layout(path: Path) -> TiffLayout:
    """Parse the first IFD of a classic or BigTIFF without reading pixel data."""
    with path.open("rb") as handle:
        header = handle.read(16)
        byte_order = header[:2]
        if byte_order == b"II":
            endian, little = "<", True
        elif byte_order == b"MM":
            endian, little = ">", False
        else:
            raise ValueError(f"{path}: not a TIFF (byte order {byte_order!r})")
        magic = struct.unpack(endian + "H", header[2:4])[0]
        if magic == 42:
            bigtiff = False
            ifd_offset = struct.unpack(endian + "I", header[4:8])[0]
        elif magic == 43:
            bigtiff = True
            ifd_offset = struct.unpack(endian + "Q", header[8:16])[0]
        else:
            raise ValueError(f"{path}: unsupported TIFF magic {magic}")

        handle.seek(ifd_offset)
        if bigtiff:
            count = struct.unpack(endian + "Q", handle.read(8))[0]
            entry_size = 20
        else:
            count = struct.unpack(endian + "H", handle.read(2))[0]
            entry_size = 12

        tags: dict[int, Any] = {}
        raw_value_bytes: dict[int, bytes] = {}
        entry_bytes = handle.read(count * entry_size)
        value_field = 12 if bigtiff else 8
        for index in range(count):
            base = index * entry_size
            tag, field_type = struct.unpack(endian + "HH", entry_bytes[base:base + 4])
            if bigtiff:
                value_count = struct.unpack(endian + "Q", entry_bytes[base + 4:base + 12])[0]
                value_bytes = entry_bytes[base + 12:base + 20]
            else:
                value_count = struct.unpack(endian + "I", entry_bytes[base + 4:base + 8])[0]
                value_bytes = entry_bytes[base + 8:base + 12]
            if field_type not in TIFF_TYPES:
                continue
            tags[tag] = _read_tag_value(handle, endian, field_type, value_count, value_bytes,
                                        ifd_offset, bigtiff)
            raw_value_bytes[tag] = value_bytes

        def tag(number: int, default=None):
            return tags.get(number, default)

        def tag_list(number: int) -> list[int]:
            """Normalize a TIFF tag that may legally hold a single inline value."""
            value = tags.get(number)
            if value is None:
                raise ValueError(f"{path}: missing required TIFF tag {number}")
            if isinstance(value, (list, tuple)):
                return [int(v) for v in value]
            return [int(value)]

        width = int(tag(256))
        height = int(tag(257))
        bits = int(tag(258, 8))
        compression = int(tag(259, 1))
        sample_format = int(tag(339, 1))
        tile_width = tag(322)
        tile_height = tag(323)
        tiled = tile_width is not None
        if tiled:
            tile_width = int(tile_width)
            tile_height = int(tile_height)
            offsets = tag_list(324)
            byte_counts = tag_list(325)
            tiles_across = (width + tile_width - 1) // tile_width
            tiles_down = (height + tile_height - 1) // tile_height
        else:
            rows_per_strip = int(tag(278, height))
            tile_width = width
            tile_height = rows_per_strip
            offsets = tag_list(273)
            byte_counts = tag_list(279)
            tiles_across = 1
            tiles_down = (height + rows_per_strip - 1) // rows_per_strip

        nodata = None
        raw_nodata = tag(42113)
        if raw_nodata is not None:
            try:
                nodata = float(str(raw_nodata).strip().rstrip("\x00"))
            except ValueError:
                nodata = None

        geo_transform = None
        scale = tag(33550)
        tiepoint = tag(33922)
        if scale and tiepoint and len(tiepoint) >= 6:
            geo_transform = [tiepoint[3], scale[0], 0.0, tiepoint[4], 0.0, -scale[1]]

        return TiffLayout(
            path=path, size=path.stat().st_size, little_endian=little, bigtiff=bigtiff,
            width=width, height=height, bits_per_sample=bits, sample_format=sample_format,
            compression=compression, tiled=tiled, tile_width=tile_width,
            tile_height=tile_height, tiles_across=tiles_across, tiles_down=tiles_down,
            offsets=offsets, byte_counts=byte_counts, nodata=nodata,
            geo_transform=geo_transform,
        )


@dataclass
class WindowRead:
    values: np.ndarray
    validity: np.ndarray
    bytes_touched: int
    ranges: int
    seconds: float


def read_window_bounded(path: Path, layout: TiffLayout, x: int, y: int,
                        width: int, height: int) -> WindowRead:
    """Read exactly one level-0 window of an uncompressed TIFF, byte-ranged.

    In-extent pixels are returned; out-of-extent pixels are invalid. This is the
    bounded native reference for the numeric-access role.
    """
    started = time.perf_counter()
    values = np.full((height, width), np.nan, dtype=np.float64)
    validity = np.zeros((height, width), dtype=bool)
    bytes_touched = 0
    ranges = 0
    with path.open("rb") as handle:
        for row in range(height):
            source_y = y + row
            if source_y < 0 or source_y >= layout.height:
                continue
            columns = np.arange(x, x + width)
            inside = (columns >= 0) & (columns < layout.width)
            if not inside.any():
                continue
            lo = int(np.argmax(inside))
            hi = int(len(columns) - np.argmax(inside[::-1]))
            start_col = int(columns[lo])
            run = hi - lo
            if not layout.is_uncompressed:
                raise ValueError("read_window_bounded requires an uncompressed TIFF")
            if layout.tiled:
                raise ValueError("read_window_bounded supports stripped fixtures only")
            base = layout.offsets[source_y // layout.tile_height]
            within = (source_y % layout.tile_height) * layout.width * layout.bytes_per_pixel
            offset = base + within + start_col * layout.bytes_per_pixel
            count = run * layout.bytes_per_pixel
            handle.seek(offset)
            raw = handle.read(count)
            bytes_touched += len(raw)
            ranges += 1
            if layout.sample_format == 3 and layout.bits_per_sample == 32:
                data = np.frombuffer(raw, dtype="<f4" if layout.little_endian else ">f4").astype(np.float64)
            elif layout.sample_format == 1 and layout.bits_per_sample == 32:
                data = np.frombuffer(raw, dtype="<i4" if layout.little_endian else ">i4").astype(np.float64)
            elif layout.sample_format == 1 and layout.bits_per_sample == 16:
                data = np.frombuffer(raw, dtype="<i2" if layout.little_endian else ">i2").astype(np.float64)
            elif layout.sample_format == 1 and layout.bits_per_sample == 8:
                data = np.frombuffer(raw, dtype="u1").astype(np.float64)
            else:
                raise ValueError(f"unsupported sample {layout.sample_format}/{layout.bits_per_sample}")
            row_valid = np.isfinite(data)
            if layout.nodata is not None:
                row_valid &= data != layout.nodata
            values[row, lo:hi] = data
            validity[row, lo:hi] = row_valid
    return WindowRead(values=values, validity=validity, bytes_touched=bytes_touched,
                      ranges=ranges, seconds=time.perf_counter() - started)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ProcessSampler:
    """Sample host-side resource use of this process tree at a fixed interval."""

    def __init__(self, interval: float = 0.1) -> None:
        self.interval = interval
        self.samples: list[dict[str, float]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._peak_rss_kib = 0

    @staticmethod
    def _tree_rss_kib(pid: int) -> tuple[int, int]:
        """Return (total RSS KiB of pid and descendants, child count)."""
        try:
            parents = subprocess.run(["ps", "-eo", "pid=,ppid=,rss="], capture_output=True,
                                     text=True, check=True).stdout.splitlines()
        except Exception:
            return 0, 0
        children: dict[int, list[int]] = {}
        rss: dict[int, int] = {}
        for line in parents:
            parts = line.split()
            if len(parts) != 3:
                continue
            cpid, ppid, value = int(parts[0]), int(parts[1]), int(parts[2])
            children.setdefault(ppid, []).append(cpid)
            rss[cpid] = value
        total = 0
        stack = [pid]
        seen = set()
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            total += rss.get(current, 0)
            stack.extend(children.get(current, []))
        return total, len(seen) - 1

    def start(self) -> None:
        self._peak_rss_kib = 0

        def loop() -> None:
            while not self._stop.is_set():
                rss, child_count = self._tree_rss_kib(os.getpid())
                self._peak_rss_kib = max(self._peak_rss_kib, rss)
                self.samples.append({"t": time.time(), "rss_kib": rss, "children": child_count})
                self._stop.wait(self.interval)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5.0)
        host_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        children_peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        peak = max([s["rss_kib"] for s in self.samples], default=0)
        max_children = max([s["children"] for s in self.samples], default=0)
        return {
            "sampler_peak_rss_kib": peak,
            "peak_rss_kib": max(peak, self._peak_rss_kib),
            "os_high_water_self_kib": host_peak,
            "os_high_water_children_kib": children_peak,
            "os_high_water_total_kib": host_peak + children_peak,
            "max_concurrent_children": max_children,
            "sample_count": len(self.samples),
            "interval_seconds": self.interval,
            "samples": self.samples,
        }


def directory_bytes(root: Path) -> int:
    total = 0
    for path in root.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total


def write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=_json_default) + "\n")
    print(json.dumps({k: v for k, v in payload.items() if k != "measurements"},
                     indent=2, sort_keys=True, default=_json_default))


def _json_default(value: Any):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Path):
        return str(value)
    return str(value)


def git_revision(repo: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)
