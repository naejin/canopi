"""Offline checks for repository Markdown links, ADR status, docs placement and line budgets.

Checks inline links/images, reference definitions, and Markdown heading fragments.
Fenced code, inline code, and external URLs are excluded. This is intentionally
not a full Markdown renderer or a network/link availability checker.
"""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
ADR_STATES = {"proposed", "accepted", "superseded", "rejected", "deprecated"}
LINK = re.compile(r"\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)")
REFERENCE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)", re.MULTILINE)
# The v2 documentation layout: anything else under docs/ is evidence or history
# that belongs in bd or nowhere.
DOCS_FILES = {"README.md", "architecture.md", "workflow.md", "v2-plan.md"}
DOCS_DIRECTORIES = {"adr", "guides", "release-notes"}
LINE_BUDGETS = {
    "AGENTS.md": 120,
    "README.md": 80,
    "CONTEXT.md": 250,
    "docs/README.md": 40,
    "docs/architecture.md": 200,
    "docs/workflow.md": 150,
    "docs/guides/map-workspace.md": 350,
    "docs/guides/design-document.md": 250,
    "docs/guides/data-library.md": 250,
    "docs/guides/frontend.md": 250,
    "docs/guides/editions.md": 150,
    "docs/guides/species-catalog.md": 200,
    "docs/guides/pdf-export.md": 200,
    "docs/guides/native-and-release.md": 250,
}
ADR_BUDGET = 60


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

    budget = LINE_BUDGETS.get(relative) or (ADR_BUDGET if relative.startswith("docs/adr/") else None)
    lines = len(text.splitlines())
    if budget is not None and lines > budget:
        errors.append(f"{relative}: {lines} lines exceeds its {budget}-line budget")
    if relative.startswith("docs/adr/"):
        status = re.search(r"^(?:status|Status):\s*(\w+)", text, re.MULTILINE)
        if not status or status[1].lower() not in ADR_STATES:
            errors.append(f"{relative}: missing/invalid ADR status")
        elif status[1].lower() == "superseded":
            replacement = re.search(r"^superseded_by:\s*(\S+)", text, re.MULTILINE)
            if not replacement or not (file.parent / replacement[1]).is_file():
                errors.append(f"{relative}: missing/invalid superseded_by target")
    return errors


def check_placement(root):
    errors = []
    docs = root / "docs"
    for path in sorted(docs.rglob("*")) if docs.is_dir() else []:
        if not path.is_file():
            continue
        parts = path.relative_to(docs).parts
        allowed = parts[0] in DOCS_DIRECTORIES if len(parts) > 1 else parts[0] in DOCS_FILES
        if not allowed:
            errors.append(f"{path.relative_to(root).as_posix()}: outside the docs layout (see docs/README.md)")
    return errors


def check(root):
    files = [root / p for p in ("AGENTS.md", "CONTEXT.md", "README.md", "desktop/web/ui-gallery/README.md", ".beads/README.md")]
    for directory in ("docs", ".interface-design"):
        files.extend((root / directory).rglob("*.md"))
    return check_placement(root) + [
        error for file in sorted(set(files)) if file.is_file() for error in check_document(file, root)
    ]


if __name__ == "__main__":
    failures = check(ROOT)
    for failure in failures:
        print(failure, file=sys.stderr)
    print(f"Documentation checks: {len(failures)} error(s)")
    sys.exit(bool(failures))
