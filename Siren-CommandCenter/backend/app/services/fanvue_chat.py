"""Fanvue chat client. The OAuth token already identifies the creator, so paths
are self-relative (no creator uuid). Validated live: GET /chats, GET /chats/{u}/messages,
POST /chats/{u}/message (singular — Fanvue's send endpoint).
The `key` selects which connected model's token to use (one per model profile).
"""
from __future__ import annotations

from . import fanvue_client


async def list_chats(page: int = 1, size: int = 30, key: str = "self") -> dict:
    return await fanvue_client.request("GET", "/chats", params={"page": page, "size": size}, key=key)


async def list_messages(fan_uuid: str, page: int = 1, size: int = 40, key: str = "self") -> dict:
    return await fanvue_client.request("GET", f"/chats/{fan_uuid}/messages", params={"page": page, "size": size}, key=key)


async def send_message(
    fan_uuid: str,
    text: str,
    *,
    media_uuids: list[str] | None = None,
    price_cents: int | None = None,
    key: str = "self",
) -> dict:
    body: dict = {"text": text}
    if media_uuids:
        body["mediaUuids"] = media_uuids
    # Fanvue PPV: price is USD cents, minimum 300 ($3), and requires attached media.
    if price_cents and media_uuids:
        body["price"] = max(300, int(price_cents))
    # Fanvue docs: POST /chats/{userUuid}/message (singular). /messages is list-only.
    return await fanvue_client.request("POST", f"/chats/{fan_uuid}/message", json=body, key=key)
