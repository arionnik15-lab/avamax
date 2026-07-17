"""Confidence-gated auto-send: let the safe replies send themselves.

Off by default, enabled per model. Only ever auto-sends a reply that carries no
money, no media, no compliance flag, and reads as ordinary conversation. Anything
with a price, an unlock, a risk flag, or the first message of a thread stays
approve-first. This is the automation jump, built so you can turn it on gradually.
"""
from __future__ import annotations

from ..security import vault
from . import compliance

_BLOCK_NOTES = ("compliance", "custom-delivery", "win-back", "follow-up", "vip-checkin")


def enabled(profile_id: int | None) -> bool:
    return bool(profile_id) and vault.get_secret(f"profile:{profile_id}:autosend") == "1"


def safe(text: str, *, price_cents: int, media_id, note: str, has_history: bool) -> bool:
    if price_cents or media_id:
        return False
    if not has_history:            # never let the very first message auto-send
        return False
    if any((note or "").startswith(n) for n in _BLOCK_NOTES):
        return False
    # 900 chars covers normal flirty replies; PPV/media still force approve.
    if not (text or "").strip() or len(text) > 900:
        return False
    if compliance.screen(text, "out")["level"] != "none":
        return False
    return True
