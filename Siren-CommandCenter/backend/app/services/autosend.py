"""Auto-send chat drafts for models that opt in.

Off by default, enabled per model. When on, free replies AND PPV/media drafts
send themselves so the operator does not have to stay awake to tap Approve.
Compliance-flagged outbound text is still held for review.
"""
from __future__ import annotations

from ..security import vault
from . import compliance


def enabled(profile_id: int | None) -> bool:
    return bool(profile_id) and vault.get_secret(f"profile:{profile_id}:autosend") == "1"


def safe(text: str, *, price_cents: int, media_id, note: str, has_history: bool) -> bool:
    """Return True if this draft may leave without a human tap.

    price_cents / media_id / has_history are accepted for API compatibility;
    with autosend on we intentionally send PPV too. Only compliance holds it.
    """
    _ = (price_cents, media_id, has_history, note)
    if not (text or "").strip() or len(text) > 900:
        return False
    if (note or "").startswith("compliance"):
        return False
    if compliance.screen(text, "out")["level"] != "none":
        return False
    return True
