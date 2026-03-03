"""
Detect and parse git patches from email bodies.
"""
import re
from typing import Optional
from models import ParsedPatch


def detect_patch(body: str, subject: str = "", message_id: str = "") -> Optional[ParsedPatch]:
    """
    Detect if an email body contains a git diff/patch.
    Returns ParsedPatch if found, None otherwise.
    Only the actual diff section is stored — not the entire email body.
    """
    if not body:
        return None

    # Try to extract a fenced diff block first (```diff ... ``` or ``` ... ```)
    diff_content = _extract_fenced_diff(body)

    if diff_content is None:
        # Check for inline diff markers
        has_diff = (
            "diff --git" in body
            or ("--- a/" in body and "+++ b/" in body)
            or re.search(r"^diff -", body, re.MULTILINE) is not None
        )
        if not has_diff:
            return None
        diff_content = _extract_inline_diff(body)

    if not diff_content:
        return None

    # Extract patch version from subject
    version = _extract_patch_version(subject)

    # Parse diff stats from the extracted diff content only
    lines_added = 0
    lines_removed = 0
    files_changed = 0
    filename: Optional[str] = None

    for line in diff_content.split("\n"):
        if line.startswith("diff --git"):
            files_changed += 1
            m = re.match(r"diff --git a/(.+?) b/", line)
            if m:
                if filename is None:
                    filename = m.group(1)
        elif line.startswith("diff -") and not line.startswith("diff --git"):
            files_changed += 1
        elif line.startswith("+") and not line.startswith("+++"):
            lines_added += 1
        elif line.startswith("-") and not line.startswith("---"):
            lines_removed += 1

    return ParsedPatch(
        filename=filename,
        content=diff_content,
        lines_added=lines_added,
        lines_removed=lines_removed,
        files_changed=files_changed,
        version=version,
        message_id=message_id,
    )


def _extract_fenced_diff(body: str) -> Optional[str]:
    """
    Extract content from a backtick-fenced code block.
    Handles ```diff, ```patch, ```c, ```sql, ``` (generic).
    """
    # Match ```<optional lang>\n...\n```
    m = re.search(
        r"```(?:diff|patch|c|sql|plpgsql|sh|bash|text)?\s*\n(.*?)```",
        body,
        re.DOTALL | re.IGNORECASE,
    )
    if m:
        content = m.group(1).rstrip()
        # Only treat it as a patch if it actually looks like a diff
        if (
            "diff --git" in content
            or ("--- a/" in content and "+++ b/" in content)
            or re.search(r"^diff -", content, re.MULTILINE)
        ):
            return content
    return None


def _extract_inline_diff(body: str) -> str:
    """
    Extract the diff section from an email body that contains inline diff text.
    Starts at the first 'diff --git' / 'diff -' / '--- a/' line and captures
    everything through the last hunk line.  Falls back to the whole body.
    """
    lines = body.split("\n")
    start_idx: Optional[int] = None
    end_idx: int = len(lines)

    for i, line in enumerate(lines):
        if start_idx is None:
            if (
                line.startswith("diff --git")
                or line.startswith("diff -")
                or (line.startswith("--- a/") and i + 1 < len(lines) and lines[i + 1].startswith("+++ b/"))
            ):
                start_idx = i
        else:
            # Heuristic end: a blank line followed by a non-diff-like line
            # that isn't part of the diff context (e.g. the author's sign-off prose)
            if line == "" and i + 1 < len(lines):
                next_line = lines[i + 1]
                # If the next line looks like normal prose (not a diff line), stop
                if next_line and not next_line.startswith(("+", "-", " ", "@", "d", "i", "B")):
                    end_idx = i + 1
                    break

    if start_idx is None:
        return body  # fallback: couldn't find start

    return "\n".join(lines[start_idx:end_idx]).rstrip()


def _extract_patch_version(subject: str) -> Optional[str]:
    """Extract patch version from subject like [PATCH v3] → 'v3'."""
    if not subject:
        return None
    # Match [PATCH v2] or [PATCH 2/3] or [PATCHv3]
    m = re.search(r"\[PATCH(?:\s+v?(\d+)(?:/\d+)?)?\]", subject, re.IGNORECASE)
    if not m:
        return None
    version_num = m.group(1)
    return f"v{version_num}" if version_num else "v1"
