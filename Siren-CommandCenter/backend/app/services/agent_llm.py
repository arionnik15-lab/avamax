"""LLM client for the agents.

Provider-agnostic over OpenAI-compatible chat APIs. Two roles with independent
provider/model preference:
  - operator  (the dashboard assistant): vault keys agent_provider / agent_model
  - chat      (the AI girl talking to fans): vault keys chat_provider / chat_model

Provider ladder is SambaNova -> Cerebras -> Groq; if the preferred one errors,
the next configured provider is tried. Keys live in the vault, never logged.
"""
from __future__ import annotations

import re

import httpx

from ..security import vault

# `model` runs the operator agent (needs clean tool-calling). `chat_model` runs the
# AI-girl chat, set to the free models that actually go uncensored when prompted
# (verified live): DeepSeek on SambaNova, Qwen on Groq. Cerebras has no permissive
# option, so it stays gpt-oss as a last resort.
PROVIDERS: dict[str, dict] = {
    "sambanova": {"base": "https://api.sambanova.ai/v1", "key": "sambanova_api_key", "model": "gpt-oss-120b", "chat_model": "DeepSeek-V3.2"},
    "cerebras": {"base": "https://api.cerebras.ai/v1", "key": "cerebras_api_key", "model": "gpt-oss-120b", "chat_model": "gpt-oss-120b"},
    "groq": {"base": "https://api.groq.com/openai/v1", "key": "groq_api_key", "model": "llama-3.3-70b-versatile", "chat_model": "llama-3.3-70b-versatile"},
}

_THINK = re.compile(r"<think>.*?</think>\s*", re.DOTALL)
_THINK_OPEN = re.compile(r"<think>.*$", re.DOTALL)
_ENDS_CLEAN = re.compile(r'[.!?…"\'\)\]]\s*$')


def _looks_truncated(finish_reason: str | None, content: str) -> bool:
    """Reasoning models sometimes get cut off (finish_reason 'length') or just stop
    mid-sentence. Either way the reply reads as unfinished."""
    if finish_reason == "length":
        return True
    t = (content or "").rstrip()
    return len(t) > 40 and not _ENDS_CLEAN.search(t)


async def _stitch(cfg: dict, key: str | None, model: str, messages: list[dict],
                  partial: str, max_rounds: int = 2) -> str:
    """Continue a reply that was cut off mid-thought, so she never ships '...I could'."""
    full = partial
    for _ in range(max_rounds):
        convo = list(messages) + [
            {"role": "assistant", "content": full},
            {"role": "user", "content": "continue your last message from exactly where it cut off, "
                                        "same voice, no repetition, just the rest of it."},
        ]
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                resp = await client.post(
                    f"{cfg['base']}/chat/completions",
                    json={"model": model, "messages": convo, "temperature": 0.7},
                    headers={"Authorization": f"Bearer {key}"},
                )
                resp.raise_for_status()
                choice = resp.json()["choices"][0]
        except Exception:  # noqa: BLE001
            break
        more = _strip_think(choice.get("message", {}).get("content") or "")
        if not more:
            break
        full = (full.rstrip() + " " + more.lstrip()).strip()
        if choice.get("finish_reason") != "length" and _ENDS_CLEAN.search(full):
            break
    return full


def _strip_think(content: str) -> str:
    """Reasoning models (Qwen3, etc.) emit <think>...</think>. Never ship it."""
    if not content or "<think>" not in content:
        return content
    s = _THINK.sub("", content)
    if "<think>" in s:  # truncated / unclosed reasoning
        s = _THINK_OPEN.sub("", s)
    return s.strip() or content


def _custom_cfg() -> dict | None:
    """An operator-supplied OpenAI-compatible endpoint, used to run an uncensored
    model for chat (OpenRouter, a self-hosted vLLM/Ollama, etc.). Configured = a
    base url + model are set; the key is custom_api_key."""
    base = vault.get_secret("custom_base_url")
    model = vault.get_secret("custom_model")
    if base and model:
        return {"base": base.rstrip("/"), "key": "custom_api_key", "model": model}
    return None


def _cfg(provider: str) -> dict | None:
    return _custom_cfg() if provider == "custom" else PROVIDERS.get(provider)


def _provider_names() -> list[str]:
    return list(PROVIDERS.keys()) + (["custom"] if _custom_cfg() else [])


def _resolve_key(cfg: dict, profile_id: int | None) -> str | None:
    """A model chats on its OWN built-in keys, no fallback. The custom uncensored
    endpoint is shared infrastructure, so it falls back to the global key. The
    operator agent (no profile_id) uses the global keys."""
    is_custom = cfg.get("key") == "custom_api_key"
    if profile_id is not None:
        own = vault.get_secret(f"profile:{profile_id}:{cfg['key']}")
        if own:
            return own
        if not is_custom:
            return None
    return vault.get_secret(cfg["key"])


def configured_providers(profile_id: int | None = None) -> list[str]:
    out = []
    for p in _provider_names():
        cfg = _cfg(p)
        if cfg and _resolve_key(cfg, profile_id):
            out.append(p)
    return out


def is_configured(profile_id: int | None = None) -> bool:
    return bool(configured_providers(profile_id))


def has_custom(profile_id: int | None = None) -> bool:
    return "custom" in configured_providers(profile_id)


def _order(pref_key: str, profile_id: int | None = None, prefer: str | None = None) -> list[str]:
    avail = configured_providers(profile_id)
    pref = prefer if (prefer and prefer in avail) else vault.get_secret(pref_key)
    if pref and pref in avail:
        return [pref] + [p for p in avail if p != pref]
    return avail


def _model(provider: str, model_key: str) -> str:
    cfg = _cfg(provider) or {}
    if provider == "custom":
        return cfg.get("model", "")
    per = vault.get_secret(f"{model_key}_{provider}")  # e.g. chat_model_groq
    if per:
        return per
    if model_key == "chat_model":
        return cfg.get("chat_model") or cfg.get("model", "")
    return vault.get_secret(model_key) or cfg.get("model", "")


async def chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    temperature: float = 0.6,
    *,
    pref_key: str = "agent_provider",
    model_key: str = "agent_model",
    profile_id: int | None = None,
    prefer: str | None = None,
) -> dict:
    """Return the assistant message dict (may contain tool_calls). Tries providers in
    order. When profile_id is set, that model's own keys win, else the global keys.
    `prefer` forces a provider to the front (used to retry on the permissive model)."""
    order = _order(pref_key, profile_id, prefer)
    if not order:
        raise RuntimeError("No LLM key set. Add a SambaNova, Cerebras, or Groq key in Settings.")
    last_exc: Exception | None = None
    for provider in order:
        cfg = _cfg(provider)
        if not cfg:
            continue
        key = _resolve_key(cfg, profile_id)
        model = _model(provider, model_key)
        payload: dict = {"model": model, "messages": messages, "temperature": temperature}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                resp = await client.post(
                    f"{cfg['base']}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {key}"},
                )
                resp.raise_for_status()
                data = resp.json()
            choice = data["choices"][0]
            msg = choice["message"]
            if msg.get("content"):
                msg["content"] = _strip_think(msg["content"])
                # Finish a reply that got cut off mid-sentence (never for tool calls).
                if not msg.get("tool_calls") and _looks_truncated(choice.get("finish_reason"), msg["content"]):
                    msg["content"] = await _stitch(cfg, key, model, messages, msg["content"])
            return msg
        except Exception as exc:  # noqa: BLE001 - try the next provider
            last_exc = exc
            continue
    raise RuntimeError(f"LLM call failed on all providers: {last_exc}")
