"""
CommitFest linker — intentionally disabled.

The CommitFest API at commitfest.postgresql.org/api/1/ returns HTML, not JSON,
so programmatic lookups are not possible. All functions here return None
gracefully so the rest of the pipeline is unaffected.
"""
from typing import Optional


async def fetch_commitfest_data(
    thread_subject: str,
    client=None,
) -> Optional[dict]:
    """
    CommitFest API is not machine-readable (returns HTML).
    Always returns None — no-op.
    """
    return None
