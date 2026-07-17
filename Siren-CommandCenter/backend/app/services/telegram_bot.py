"""Two-way Telegram bridge for Siren, the operator agent.

the owner DMs the bot and gets agent replies; the same bot is the channel for
proactive pings (new fan messages, content needed) that flow through notify.
Only the configured chat id may talk to her. Long-polls getUpdates in a
background task. Nothing is exposed publicly.
"""
from __future__ import annotations

import asyncio
from collections import deque

import httpx

from ..db import execute, query_all, query_one
from ..security import vault
from . import agent

_task: "asyncio.Task | None" = None
_history: deque = deque(maxlen=16)
_API = "https://api.telegram.org/bot{token}/{method}"

_WELCOME = (
    "Hey, I'm Siren. I run the command center with you.\n\n"
    "Ask me about the accounts, earnings, who to reply to, what to post, or draft DMs and captions. "
    "Tell me what content to make and I'll log it to your queue. I'll also ping you here when a fan "
    "messages or when something needs creating.\n\n"
    "Chat drafts: tap Approve on the ping, or /drafts then /send <id> or /skipdraft <id>.\n"
    "Posts: /queue, then /approve <id> or /skip <id> (or the buttons on a post ping).\n"
    "/reset starts a fresh thread."
)


def _cfg() -> tuple[str | None, str | None]:
    return vault.get_secret("telegram_bot_token"), vault.get_secret("telegram_chat_id")


def _chunks(text: str, n: int = 3800) -> list[str]:
    text = (text or "").strip() or "…"
    return [text[i : i + n] for i in range(0, len(text), n)]


async def _send(client: httpx.AsyncClient, token: str, chat_id: str, text: str) -> None:
    for chunk in _chunks(text):
        try:
            await client.post(
                _API.format(token=token, method="sendMessage"),
                json={"chat_id": chat_id, "text": chunk, "disable_web_page_preview": True},
            )
        except Exception:  # noqa: BLE001
            pass


async def _post_action(action: str, post_id: int) -> str:
    """Approve+publish or skip a post from Telegram. Returns a reply line."""
    from . import posting
    p = posting.get_post(post_id)
    if not p:
        return f"No post #{post_id}."
    if action == "skip":
        posting.skip(post_id)
        return f"Post #{post_id} skipped."
    if action == "approve":
        posting.approve(post_id)
        await posting.run_post(post_id)
        p2 = posting.get_post(post_id) or {}
        if p2.get("status") == "failed":
            return f"Post #{post_id} failed: {p2.get('error')}"
        return f"Post #{post_id} {p2.get('status') or 'sent'}."
    return "Unknown action."


async def _chat_action(action: str, message_id: int) -> str:
    """Approve+send or skip a Fanvue chat draft from Telegram."""
    msg = query_one("SELECT * FROM chat_messages WHERE id = ?", (message_id,))
    if not msg or msg["status"] != "draft":
        return f"No chat draft #{message_id}."
    if action == "skip":
        execute(
            "UPDATE chat_messages SET status = 'skipped' WHERE id = ? AND status = 'draft'",
            (message_id,),
        )
        return f"Draft #{message_id} skipped."
    if action == "approve":
        from . import deliver
        try:
            await deliver.deliver_message(message_id)
        except Exception as exc:  # noqa: BLE001
            return f"Draft #{message_id} failed to send: {exc}"
        return f"Draft #{message_id} sent on Fanvue."
    return "Unknown action."


async def _handle(client: httpx.AsyncClient, token: str, chat_id: str, text: str) -> None:
    t = (text or "").strip()
    if t in ("/start", "/help"):
        _history.clear()
        await _send(client, token, chat_id, _WELCOME)
        return
    if t == "/reset":
        _history.clear()
        await _send(client, token, chat_id, "Fresh start. What's up?")
        return
    if t == "/drafts":
        rows = query_all(
            "SELECT m.id, m.text, m.price_cents, t.fan_name "
            "FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id "
            "WHERE m.status = 'draft' AND m.role = 'model' "
            "ORDER BY m.id DESC LIMIT 20"
        )
        if not rows:
            await _send(client, token, chat_id, "No chat drafts waiting.")
            return
        lines = []
        for r in rows:
            snip = (r["text"] or "").replace("\n", " ")[:80]
            price = int(r["price_cents"] or 0)
            tag = f" ${price/100:.0f}" if price else ""
            lines.append(f"#{r['id']} {r['fan_name'] or 'fan'}{tag}: {snip}")
        await _send(
            client, token, chat_id,
            "Chat drafts waiting:\n" + "\n".join(lines) + "\n\nReply /send <id> or /skipdraft <id>.",
        )
        return
    if t == "/queue":
        from . import posting
        drafts = posting.list_posts(status="draft")
        if not drafts:
            await _send(client, token, chat_id, "No posts waiting for approval.")
            return
        lines = [
            f"#{d['id']} {d.get('profile_name') or 'unassigned'}: {(d['caption'] or '(no caption)')[:80]}"
            for d in drafts[:20]
        ]
        await _send(client, token, chat_id,
                    "Waiting for your ok:\n" + "\n".join(lines) + "\n\nReply /approve <id> or /skip <id>.")
        return
    if t.startswith("/send") or t.startswith("/skipdraft"):
        parts = t.split()
        action = "approve" if parts[0].startswith("/send") else "skip"
        if len(parts) < 2 or not parts[1].lstrip("#").isdigit():
            await _send(client, token, chat_id, f"Use {parts[0]} <id>. See /drafts for ids.")
            return
        reply = await _chat_action(action, int(parts[1].lstrip("#")))
        await _send(client, token, chat_id, reply)
        return
    if t.startswith("/approve") or t.startswith("/skip"):
        parts = t.split()
        action = "approve" if parts[0].startswith("/approve") else "skip"
        if len(parts) < 2 or not parts[1].lstrip("#").isdigit():
            await _send(client, token, chat_id, f"Use {parts[0]} <id>. See /queue for ids.")
            return
        reply = await _post_action(action, int(parts[1].lstrip("#")))
        await _send(client, token, chat_id, reply)
        return
    if not t:
        await _send(client, token, chat_id, "Send me text and I'll help.")
        return

    _history.append({"role": "user", "content": t})
    try:
        await client.post(
            _API.format(token=token, method="sendChatAction"),
            json={"chat_id": chat_id, "action": "typing"},
        )
    except Exception:  # noqa: BLE001
        pass
    try:
        result = await agent.run_turn(list(_history))
        reply = (result.get("reply") or "").strip() or "I didn't catch that, try again?"
    except Exception:  # noqa: BLE001
        reply = "Something glitched on my end. Try that again in a sec."
    _history.append({"role": "assistant", "content": reply})
    await _send(client, token, chat_id, reply)


async def _handle_callback(client: httpx.AsyncClient, token: str, chat_id: str, cb: dict) -> None:
    """Approve/Skip tapped on a post or chat-draft ping."""
    data = cb.get("data") or ""
    reply = "Didn't catch that."
    parts = data.split(":")
    if len(parts) == 3 and parts[2].isdigit():
        kind, action, oid = parts[0], parts[1], int(parts[2])
        if kind == "post":
            reply = await _post_action(action, oid)
        elif kind == "chat":
            reply = await _chat_action(action, oid)
    try:
        await client.post(
            _API.format(token=token, method="answerCallbackQuery"),
            json={"callback_query_id": cb.get("id"), "text": reply[:200]},
        )
    except Exception:  # noqa: BLE001
        pass
    await _send(client, token, chat_id, reply)


async def _loop() -> None:
    token, chat_id = _cfg()
    if not (token and chat_id):
        return
    chat_id = str(chat_id)
    offset = int(vault.get_secret("telegram_update_offset") or 0)
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
        while True:
            try:
                r = await client.get(
                    _API.format(token=token, method="getUpdates"),
                    params={"offset": offset, "timeout": 30},
                )
                updates = (r.json() or {}).get("result") or []
                for upd in updates:
                    offset = upd["update_id"] + 1
                    cb = upd.get("callback_query")
                    if cb:
                        cb_chat = str(((cb.get("message") or {}).get("chat") or {}).get("id"))
                        if cb_chat == chat_id:
                            await _handle_callback(client, token, chat_id, cb)
                        continue
                    msg = upd.get("message") or upd.get("edited_message")
                    if not msg:
                        continue
                    if str((msg.get("chat") or {}).get("id")) != chat_id:
                        continue  # only the operator may talk to her
                    await _handle(client, token, chat_id, msg.get("text") or "")
                if updates:
                    vault.set_secret("telegram_update_offset", str(offset))
            except Exception:  # noqa: BLE001
                await asyncio.sleep(3)


def running() -> bool:
    return bool(_task and not _task.done())


def start_poller() -> None:
    """Start the long-poll loop if a token + chat id are set. Idempotent."""
    global _task
    if running() or not all(_cfg()):
        return
    _task = asyncio.get_running_loop().create_task(_loop())
