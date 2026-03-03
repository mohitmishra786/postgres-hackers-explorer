import json
import os
import aiofiles
from datetime import datetime
from models import RawEmail
from config import OUTPUT_DIR, OUTPUT_JSON_PATH, STATE_FILE_PATH
from logger import setup_logger

logger = setup_logger()


def ensure_output_dir() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)


async def write_email(email: RawEmail) -> None:
    """Append a single email as a JSON line to the output file."""
    ensure_output_dir()
    record = email.model_dump(mode="json")
    # Serialize datetime objects
    for key, val in record.items():
        if isinstance(val, datetime):
            record[key] = val.isoformat()
    async with aiofiles.open(OUTPUT_JSON_PATH, "a", encoding="utf-8") as f:
        await f.write(json.dumps(record) + "\n")


def read_all_emails() -> list[dict]:
    """Read all emails from the JSONL output file."""
    if not os.path.exists(OUTPUT_JSON_PATH):
        return []
    emails = []
    with open(OUTPUT_JSON_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    emails.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("invalid_json_line", line=line[:100])
    return emails


def write_all_emails(emails: list[dict]) -> None:
    """Overwrite the output file with the given list of email dicts."""
    ensure_output_dir()
    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as f:
        for email in emails:
            f.write(json.dumps(email) + "\n")


def load_crawl_state() -> dict:
    """Load the crawl state (which months have been fully processed)."""
    if not os.path.exists(STATE_FILE_PATH):
        return {"completed_months": [], "last_crawl": None}
    with open(STATE_FILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_crawl_state(state: dict) -> None:
    """Persist the crawl state."""
    ensure_output_dir()
    with open(STATE_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, default=str)
