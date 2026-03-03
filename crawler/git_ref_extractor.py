"""
Extract git commit references from email bodies.
"""
import re


def extract_git_refs(body: str) -> list[str]:
    """
    Find all 7-40 character hex strings that look like git commit hashes,
    and any references to git.postgresql.org URLs.

    Returns a deduplicated list.
    """
    refs: set[str] = set()

    # Git commit hashes: 7-40 hex characters
    # Must be surrounded by word boundaries to avoid matching random hex in URLs
    hex_pattern = re.compile(r"\b([0-9a-f]{7,40})\b")
    for m in hex_pattern.finditer(body):
        candidate = m.group(1)
        # Filter out common false positives (pure numbers, very short)
        if len(candidate) >= 7 and not candidate.isdigit():
            refs.add(candidate)

    # git.postgresql.org URLs containing commit hashes
    url_pattern = re.compile(
        r"https?://git\.postgresql\.org/\S*[;?&]h=([0-9a-f]{7,40})"
    )
    for m in url_pattern.finditer(body):
        refs.add(m.group(1))

    return sorted(refs)
