"""One send path, reused by chat approval, auto-send, blasts, and custom delivery.

Sends through the model's own Fanvue connection when linked; otherwise records the
send locally (for testing). Tags the send with any experiment variant so a later
purchase can credit the winning variant.
"""
from __future__ import annotations

from ..db import execute, query_one
from . import (
    experiments, fanvue_chat, fanvue_media, fanvue_oauth, media_store, sends as sends_svc,
)


async def deliver_to_fan(
    profile_id: int | None, fan_uuid: str, fan_name: str, text: str,
    *, media_id: int | None = None, price_cents: int = 0, angle: str = "",
) -> bool:
    key = fanvue_oauth.profile_key(profile_id) if profile_id else "self"
    sent = False
    if fanvue_oauth.is_connected(key) and not str(fan_uuid).startswith("test-"):
        media_uuids = None
        if media_id:
            data, _row = media_store.load_media(media_id) or (None, None)
            if data:
                media_uuids = [await fanvue_media.upload(data, key=key)]
        try:
            await fanvue_chat.send_message(
                fan_uuid, text, media_uuids=media_uuids, price_cents=price_cents or None, key=key)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"Fanvue send failed: {exc}. "
                "Reconnect Fanvue in Settings and ensure write:chat scope is enabled."
            ) from exc
        sent = True
    elif not str(fan_uuid).startswith("test-") and profile_id is not None:
        # Linked model thread but OAuth key missing/mismatched — don't fake success.
        if not fanvue_oauth.is_connected(key):
            raise RuntimeError(
                f"Fanvue is not connected for this model (need {key}). "
                "Open Settings → Fanvue → Connect again."
            )
    if media_id:
        sends_svc.record_send(
            media_id, fan_uuid, profile_id=profile_id, fan_name=fan_name, kind="ppv",
            price_cents=price_cents or 0, angle=angle)
    return sent


async def deliver_message(message_id: int) -> bool:
    """Send a stored draft message and mark it sent. Records an experiment
    impression when a variant-tagged unlock goes out."""
    msg = query_one("SELECT * FROM chat_messages WHERE id = ?", (message_id,))
    if not msg or msg["status"] != "draft":
        return False
    thread = query_one("SELECT * FROM chat_threads WHERE id = ?", (msg["thread_id"],))
    if not thread:
        return False
    exp = msg["exp"] if "exp" in msg.keys() else ""
    ok = await deliver_to_fan(
        thread["profile_id"], thread["fan_uuid"], thread["fan_name"], msg["text"],
        media_id=msg["media_id"], price_cents=msg["price_cents"] or 0, angle=exp or "")
    execute("UPDATE chat_messages SET status = 'sent' WHERE id = ?", (message_id,))
    if exp and (msg["media_id"] or msg["price_cents"]):
        parsed = experiments.parse_tag(exp)
        if parsed:
            experiments.record_impression(*parsed)
    return ok
