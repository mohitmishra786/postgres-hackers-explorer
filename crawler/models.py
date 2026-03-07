from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional


class RawEmail(BaseModel):
    message_id: str
    in_reply_to: Optional[str] = None
    references: list[str] = []
    subject: str
    author_name: str
    author_email_obfuscated: str
    date: datetime
    body_raw: str
    body_clean: str           # quoted lines stripped
    body_new_content: str     # only lines the author wrote (no > prefix lines)
    source_url: str
    month_period: str         # "2024/03"
    marc_thread_id: Optional[str] = None   # MARC ?t=THREADID — stable thread group key
    thread_root_id: Optional[str] = None  # filled in post-processing
    thread_depth: int = 0
    has_patch: bool = False
    patch_version: Optional[str] = None
    patch_content: Optional[str] = None       # extracted diff text
    patch_lines_added: int = 0
    patch_lines_removed: int = 0
    patch_files_changed: int = 0
    patch_filename: Optional[str] = None       # first changed file
    git_commit_refs: list[str] = []

    @field_validator("message_id", "subject", mode="before")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v


class ParsedPatch(BaseModel):
    filename: Optional[str] = None
    content: str
    lines_added: int = 0
    lines_removed: int = 0
    files_changed: int = 0
    version: Optional[str] = None
    message_id: str
