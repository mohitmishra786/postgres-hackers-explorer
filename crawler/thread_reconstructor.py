"""
Second-pass thread reconstruction.

Strategy depends on the data source:
- MARC.info emails: use the ?t=THREADID from the HTML page (stored as marc_thread_id).
  MARC strips In-Reply-To/References from its HTML/mbox views, so the thread ID link
  is the only reliable grouping signal. We use "<marc-thread-THREADID>" as thread_root_id.
- Legacy postgresql.org emails: walk In-Reply-To/References chains as before.
"""
from logger import setup_logger

logger = setup_logger()


def reconstruct_threads(emails: list[dict]) -> list[dict]:
    """
    Assign thread_root_id and thread_depth to every email.

    For MARC emails (marc_thread_id present): group by marc_thread_id directly.
    For legacy emails: walk In-Reply-To/References chains.
    """
    logger.info("reconstructing_threads", email_count=len(emails))

    # --- Pass 1: MARC emails — group by marc_thread_id ---
    # Build a map: marc_thread_id -> earliest (lowest date) message_id in that thread.
    # We use that as the canonical thread_root_id so it matches a real email in the DB.
    marc_thread_root: dict[str, str] = {}   # marc_thread_id -> chosen root message_id
    marc_thread_date: dict[str, object] = {}  # marc_thread_id -> earliest date seen

    marc_emails = [e for e in emails if e.get("marc_thread_id")]
    non_marc_emails = [e for e in emails if not e.get("marc_thread_id")]

    for email in marc_emails:
        tid = email["marc_thread_id"]
        date = email.get("date")
        if tid not in marc_thread_root:
            marc_thread_root[tid] = email["message_id"]
            marc_thread_date[tid] = date
        else:
            # Keep the earliest-dated email as the root
            existing_date = marc_thread_date[tid]
            if date and existing_date and date < existing_date:
                marc_thread_root[tid] = email["message_id"]
                marc_thread_date[tid] = date

    for email in marc_emails:
        tid = email["marc_thread_id"]
        root_id = marc_thread_root[tid]
        email["thread_root_id"] = root_id
        # Depth: 0 if this email IS the root, else 1+ (we don't have exact depth from MARC)
        email["thread_depth"] = 0 if email["message_id"] == root_id else 1

    # --- Pass 2: legacy emails — walk In-Reply-To/References ---
    if non_marc_emails:
        by_id: dict[str, dict] = {e["message_id"]: e for e in non_marc_emails}

        def find_root(start_email: dict) -> tuple[str, int]:
            visited: set[str] = set()
            current = start_email
            depth = 0
            while True:
                mid = current["message_id"]
                if mid in visited:
                    break
                visited.add(mid)
                parent_id = current.get("in_reply_to")
                if not parent_id:
                    refs = current.get("references") or []
                    if refs:
                        parent_id = refs[-1]
                if not parent_id or parent_id not in by_id:
                    break
                current = by_id[parent_id]
                depth += 1
            return current["message_id"], depth

        for email in non_marc_emails:
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

    marc_threads = len(marc_thread_root)
    non_marc_thread_roots = len({e["thread_root_id"] for e in non_marc_emails})
    logger.info(
        "thread_reconstruction_complete",
        marc_emails=len(marc_emails),
        marc_threads=marc_threads,
        non_marc_emails=len(non_marc_emails),
        non_marc_threads=non_marc_thread_roots,
    )

    return emails
