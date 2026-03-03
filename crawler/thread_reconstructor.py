"""
Second-pass thread reconstruction using In-Reply-To and References headers.
"""
from logger import setup_logger

logger = setup_logger()


def reconstruct_threads(emails: list[dict]) -> list[dict]:
    """
    Assign thread_root_id and thread_depth to every email.
    Uses In-Reply-To and References headers to build the thread tree.
    """
    logger.info("reconstructing_threads", email_count=len(emails))

    # Build lookup by message_id
    by_id: dict[str, dict] = {e["message_id"]: e for e in emails}

    def find_root(start_email: dict) -> tuple[str, int]:
        """Iteratively find the root message ID to avoid stack overflow on deep threads."""
        visited: set[str] = set()
        current = start_email
        depth = 0
        while True:
            mid = current["message_id"]
            if mid in visited:
                # Cycle detected — treat current as root
                break
            visited.add(mid)
            parent_id = current.get("in_reply_to")
            if not parent_id or parent_id not in by_id:
                break
            current = by_id[parent_id]
            depth += 1
        return current["message_id"], depth

    for email in emails:
        try:
            root_id, depth = find_root(email)
            email["thread_root_id"] = root_id
            email["thread_depth"] = depth
        except Exception as e:
            logger.warning(
                "thread_reconstruction_failed",
                message_id=email.get("message_id"),
                error=str(e),
            )
            email["thread_root_id"] = email["message_id"]
            email["thread_depth"] = 0

    return emails
