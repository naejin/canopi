"""Offline checks for repository Markdown links and document lifecycle headers.

Checks inline links/images, reference definitions, and Markdown heading fragments.
Fenced code, inline code, and external URLs are excluded. This is intentionally
not a full Markdown renderer or a network/link availability checker.
"""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DESIGN_STATES = {"proposed", "active", "partial", "completed", "retired", "evidence"}
ADR_STATES = {"proposed", "accepted", "superseded", "rejected", "deprecated"}
LINK = re.compile(r"\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)")
REFERENCE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)", re.MULTILINE)


def prose(text):
    lines = []
    fence = None
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            lines.append("")
        elif marker:
            fence = marker[1]
            lines.append("")
        else:
            lines.append(line)
    return "\n".join(lines)


def anchors(text):
    used = set()
    for line in prose(text).splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)(?:\s+#+)?$", line)
        if match:
            slug = re.sub(r"[^\w\- ]", "", match[1].lower()).replace(" ", "-")
            unique, suffix = slug, 0
            while unique in used:
                suffix += 1
                unique = f"{slug}-{suffix}"
            used.add(unique)
    used.update(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    return used


def check_document(file, root):
    text = file.read_text(encoding="utf-8")
    body = prose(text)
    # Backtick-delimited examples are not navigable Markdown links.
    body = re.sub(r"(`+).*?\1", "", body)
    errors = []
    relative = file.relative_to(root).as_posix()
    for match in list(LINK.finditer(body)) + list(REFERENCE.finditer(body)):
        target = match[1].strip("<>")
        url = urlsplit(target)
        if url.scheme or url.netloc:
            continue
        path = unquote(url.path)
        dest = (root / path.lstrip("/") if path.startswith("/") else file.parent / path) if path else file
        line = body[:match.start()].count("\n") + 1
        if not dest.exists():
            errors.append(f"{relative}:{line}: missing target {target}")
        elif url.fragment and dest.suffix == ".md" and unquote(url.fragment) not in anchors(dest.read_text(encoding="utf-8")):
            errors.append(f"{relative}:{line}: missing heading {target}")

    if relative.startswith("docs/design/"):
        header = text.split("\n## ", 1)[0]
        status = re.search(r"^Status:\s*(\w+)", header, re.MULTILINE)
        if not status or status[1].lower() not in DESIGN_STATES:
            errors.append(f"{relative}: missing/invalid design Status header")
        if not re.search(r"^Tracking:.*`canopi-[\w.]+`", header, re.MULTILINE):
            errors.append(f"{relative}: missing Tracking bead header")
        if not re.search(r"^Current guidance:.*\]\(", header, re.MULTILINE):
            errors.append(f"{relative}: missing Current guidance link header")
    if relative.startswith("docs/adr/"):
        status = re.search(r"^(?:status|Status):\s*(\w+)", text, re.MULTILINE)
        if not status or status[1].lower() not in ADR_STATES:
            errors.append(f"{relative}: missing/invalid ADR status")
        elif status[1].lower() == "superseded":
            replacement = re.search(r"^superseded_by:\s*(\S+)", text, re.MULTILINE)
            if not replacement or not (file.parent / replacement[1]).is_file():
                errors.append(f"{relative}: missing/invalid superseded_by target")
    return errors


def check(root):
    files = [root / p for p in ("AGENTS.md", "CONTEXT.md", "README.md", "desktop/web/ui-gallery/README.md", ".beads/README.md")]
    for directory in ("docs", ".interface-design"):
        files.extend((root / directory).rglob("*.md"))
    return [error for file in sorted(set(files)) if file.is_file() for error in check_document(file, root)]


if __name__ == "__main__":
    failures = check(ROOT)
    for failure in failures:
        print(failure, file=sys.stderr)
    print(f"Documentation checks: {len(failures)} error(s)")
    sys.exit(bool(failures))
