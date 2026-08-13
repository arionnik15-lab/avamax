"""Fanvue API client.

Auth: OAuth 2.0 access token from fanvue_oauth (auto-refreshed) plus the
X-Fanvue-API-Version header. Amounts in the Fanvue API are USD cents.

The published docs show a couple of path prefixes for the same resources, so each
method tries the documented variants and uses whichever the live API answers.
A short response cache respects the 100-requests / 60-seconds limit.
"""
from __future__ import annotations

import time

import httpx

from . import fanvue_oauth

FANVUE_BASE = "https://api.fanvue.com"
API_VERSION = "2025-06-26"


def is_configured() -> bool:
    """At least one Fanvue account is connected."""
    return fanvue_oauth.any_connected()


async def _headers(key: str = "self") -> dict:
    token = await fanvue_oauth.valid_access_token(key)
    return {
        "Authorization": f"Bearer {token}",
        "X-Fanvue-API-Version": API_VERSION,
        "Accept": "application/json",
    }


_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 60.0


async def _get_first(paths: list[str], params: dict | None = None, key: str = "self") -> dict:
    """Try each path, skipping 404s, until one answers. Cached by the first path."""
    cache_key = paths[0] + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    now = time.time()
    hit = _cache.get(cache_key)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]

    headers = await _headers(key)
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        for path in paths:
            try:
                resp = await client.get(f"{FANVUE_BASE}{path}", params=params, headers=headers)
                if resp.status_code == 404:
                    continue
                resp.raise_for_status()
                data = resp.json()
                _cache[cache_key] = (now, data)
                return data
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                if exc.response.status_code == 404:
                    continue
                raise
    if last_exc:
        raise last_exc
    raise RuntimeError(f"All path variants returned 404: {paths}")


async def account_self(key: str = "self") -> dict:
    return await _get_first(["/users/account", "/current-user/account"], key=key)


async def earnings_summary_self() -> dict:
    return await _get_first(["/earnings/summary", "/insights/earnings/summary"])


async def earnings_summary_for(creator_uuid: str) -> dict:
    return await _get_first([
        f"/earnings/summary/{creator_uuid}",
        f"/creators/{creator_uuid}/insights/earnings/summary",
    ])


async def agency_creators(page: int = 1, size: int = 50) -> dict:
    return await _get_first(["/agency/creators", "/creators"], {"page": page, "size": size})


async def top_spenders_self(page: int = 1, size: int = 15) -> dict:
    return await _get_first(["/fans/top-spending", "/insights/top-spenders"], {"page": page, "size": size})


async def top_spenders_for(creator_uuid: str, page: int = 1, size: int = 15) -> dict:
    return await _get_first([
        f"/fans/top-spending/{creator_uuid}",
        f"/creators/{creator_uuid}/insights/top-spenders",
    ], {"page": page, "size": size})


# --- generic request + creator uuid (used by chat / insights / media clients) ---

_creator_uuid_cache: str | None = None


async def request(method: str, path: str, *, json: dict | None = None, params: dict | None = None, key: str = "self") -> dict:
    headers = await _headers(key)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        resp = await client.request(method, f"{FANVUE_BASE}{path}", json=json, params=params, headers=headers)
        if resp.status_code >= 400:
            detail = (resp.text or "")[:400]
            raise RuntimeError(f"Fanvue {method} {path} -> {resp.status_code}: {detail}")
        return resp.json() if resp.content else {}


def _find_uuid(d) -> str | None:
    if not isinstance(d, dict):
        return None
    for k in ("uuid", "creatorUuid", "userUuid", "id"):
        v = d.get(k)
        if isinstance(v, str) and v:
            return v
    for k in ("user", "profile", "data", "account", "creator"):
        v = d.get(k)
        if isinstance(v, dict):
            u = _find_uuid(v)
            if u:
                return u
    return None


async def creator_uuid(key: str = "self") -> str:
    """The connected creator's uuid, used in /v1/creators/{uuid}/... paths. Cached."""
    global _creator_uuid_cache
    if _creator_uuid_cache:
        return _creator_uuid_cache
    for path in ("/v1/users/me", "/v1/me", "/current-user/account", "/users/account"):
        try:
            data = await request("GET", path, key=key)
        except Exception:  # noqa: BLE001
            continue
        uuid = _find_uuid(data)
        if uuid:
            _creator_uuid_cache = uuid
            return uuid
    raise RuntimeError("Could not resolve the connected Fanvue creator uuid.")
