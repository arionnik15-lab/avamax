"""Chat inbox (approve-first). The AI girl drafts; the operator reviews here and
sends. Conversations can be created manually to test reply quality before Fanvue
is connected; once connected, the poller fills real threads.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException

from ..db import execute, query_all, query_one
from ..models import ChatRate, ChatThreadIn, ChatToggle, DraftEdit, FanMessageIn, PlaybookIn
from ..security import vault
from ..security.auth import require_admin
from ..services import chat_agent, fanvue_chat, fanvue_media, fanvue_oauth, media_store, sends as sends_svc, tiers

router = APIRouter(prefix="/api/chat", tags=["chat"])

_TIERS = ("whale", "dolphin", "shrimp", "new")


@router.get("/playbook")
def get_playbook(_: dict = Depends(require_admin)) -> dict:
    return {
        "whale_cents": int(vault.get_secret("tier_whale_cents") or tiers.DEFAULT_WHALE),
        "dolphin_cents": int(vault.get_secret("tier_dolphin_cents") or tiers.DEFAULT_DOLPHIN),
        "strategies": {t: tiers.strategy_for(t) for t in _TIERS},
    }


@router.post("/playbook")
def set_playbook(body: PlaybookIn, _: dict = Depends(require_admin)) -> dict:
    vault.set_secret("tier_whale_cents", str(int(body.whale_cents)))
    vault.set_secret("tier_dolphin_cents", str(int(body.dolphin_cents)))
    for t, v in (body.strategies or {}).items():
        if t in _TIERS and isinstance(v, str):
            vault.set_secret(f"tier_strategy_{t}", v)
    return {"ok": True}


@router.get("/status")
def status(_: dict = Depends(require_admin)) -> dict:
    return {"enabled": chat_agent.chat_enabled(), "connected": fanvue_oauth.any_connected()}


@router.get("/whales")
def whale_list(profile_id: int | None = None, _: dict = Depends(require_admin)) -> list[dict]:
    from ..services import whales
    return whales.whales(profile_id)


@router.post("/sync")
async def sync(_: dict = Depends(require_admin)) -> dict:
    n = await chat_agent.pull_now()
    return {"pulled": n}


@router.post("/toggle")
def toggle(body: ChatToggle, _: dict = Depends(require_admin)) -> dict:
    vault.set_secret("chat_enabled", "1" if body.enabled else "0")
    if body.enabled:
        chat_agent.start_poller()
    return {"enabled": body.enabled}


def _ts(s):
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.strptime(s.replace("Z", "").replace("T", " ").split(".")[0].strip(), "%Y-%m-%d %H:%M:%S")
    except Exception:  # noqa: BLE001
        return None


@router.get("/threads")
def threads(_: dict = Depends(require_admin)) -> list[dict]:
    rows = query_all(
        "SELECT t.*, "
        "(SELECT text FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_text, "
        "(SELECT status FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_status "
        "FROM chat_threads t ORDER BY COALESCE(t.last_message_at, t.last_inbound_at, '') DESC, t.id DESC"
    )
    for r in rows:
        # Unread only when the fan sent the last message and you haven't opened it since.
        lm, op = _ts(r.get("last_message_at")), _ts(r.get("opened_at"))
        r["unread"] = (r.get("last_status") == "inbound") and bool(lm) and (op is None or lm > op)
        # Tier strictly from real lifetime spend. (Fanvue's isTopSpender flag is unreliable
        # and was mislabeling $0 fans as whales, so it is not used for tiering.)
        r["tier"] = tiers.tier_for(int(r.get("fan_spend_cents") or 0))
    return rows


@router.post("/threads")
def create_thread(body: ChatThreadIn, _: dict = Depends(require_admin)) -> dict:
    fan_uuid = f"test-{uuid.uuid4().hex[:12]}"
    tid = execute(
        "INSERT INTO chat_threads(profile_id, fan_uuid, fan_name, last_inbound_at) VALUES(?,?,?,datetime('now'))",
        (body.profile_id, fan_uuid, body.fan_name),
    )
    return query_one("SELECT * FROM chat_threads WHERE id = ?", (tid,))


@router.get("/threads/{thread_id}")
def thread_detail(thread_id: int, _: dict = Depends(require_admin)) -> dict:
    thread = query_one("SELECT * FROM chat_threads WHERE id = ?", (thread_id,))
    if not thread:
        raise HTTPException(404, "Thread not found.")
    execute("UPDATE chat_threads SET opened_at = datetime('now') WHERE id = ?", (thread_id,))  # mark read
    messages = query_all(
        "SELECT id, role, text, media_id, price_cents, status, provider, rating, note, created_at "
        "FROM chat_messages WHERE thread_id = ? ORDER BY id",
        (thread_id,),
    )
    sent = sends_svc.for_fan(thread.get("profile_id"), thread["fan_uuid"])
    return {"thread": thread, "messages": messages, "sent": sent}


@router.post("/threads/{thread_id}/fan-message")
async def add_fan_message(thread_id: int, body: FanMessageIn, _: dict = Depends(require_admin)) -> dict:
    if not query_one("SELECT 1 FROM chat_threads WHERE id = ?", (thread_id,)):
        raise HTTPException(404, "Thread not found.")
    execute(
        "INSERT INTO chat_messages(thread_id, role, text, status) VALUES(?,?,?,'inbound')",
        (thread_id, "fan", body.text),
    )
    execute("UPDATE chat_threads SET last_inbound_at = datetime('now') WHERE id = ?", (thread_id,))
    draft = await chat_agent.generate_draft(thread_id)
    return draft


@router.post("/threads/{thread_id}/draft")
async def regenerate(thread_id: int, _: dict = Depends(require_admin)) -> dict:
    if not query_one("SELECT 1 FROM chat_threads WHERE id = ?", (thread_id,)):
        raise HTTPException(404, "Thread not found.")
    return await chat_agent.generate_draft(thread_id)


@router.patch("/messages/{message_id}")
def edit_draft(message_id: int, body: DraftEdit, _: dict = Depends(require_admin)) -> dict:
    if not query_one("SELECT 1 FROM chat_messages WHERE id = ? AND status = 'draft'", (message_id,)):
        raise HTTPException(404, "Draft not found.")
    if body.text is not None:
        execute("UPDATE chat_messages SET text = ? WHERE id = ?", (body.text, message_id))
    if body.price_cents is not None:
        execute("UPDATE chat_messages SET price_cents = ? WHERE id = ?", (body.price_cents, message_id))
    if body.media_id is not None:
        execute("UPDATE chat_messages SET media_id = ? WHERE id = ?", (body.media_id or None, message_id))
    return {"ok": True}


@router.post("/messages/{message_id}/approve")
async def approve(message_id: int, _: dict = Depends(require_admin)) -> dict:
    msg = query_one("SELECT * FROM chat_messages WHERE id = ?", (message_id,))
    if not msg or msg["status"] != "draft":
        raise HTTPException(404, "Draft not found.")
    from ..services import deliver
    try:
        await deliver.deliver_message(message_id)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"ok": True}


@router.post("/messages/{message_id}/rate")
def rate(message_id: int, body: ChatRate, _: dict = Depends(require_admin)) -> dict:
    if body.rating not in ("good", "bad", ""):
        raise HTTPException(400, "Invalid rating.")
    execute("UPDATE chat_messages SET rating = ? WHERE id = ?", (body.rating, message_id))
    return {"ok": True}
