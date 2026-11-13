"""Small JSON POST helper (standard library only), shared by all HTTP providers."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict
from urllib.parse import urlparse

from ..types import ProviderError

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}


def assert_secure_url(provider: str, url: str) -> None:
    """Only HTTPS is allowed, except for local endpoints (Ollama, LM Studio, tests). Keys never travel in clear text."""
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return
    if parsed.scheme == "http" and parsed.hostname in LOCAL_HOSTS:
        return
    raise ProviderError(provider, f"Insecure URL refused (use https): {parsed.scheme}://{parsed.hostname}", 0)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward API keys to a redirected host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        raise urllib.error.HTTPError(req.full_url, code, f"Redirect refused to {newurl}", headers, fp)


_OPENER = urllib.request.build_opener(_NoRedirect)


def post_json(provider: str, url: str, body: Any, headers: Dict[str, str], timeout: float = 60.0) -> Dict[str, Any]:
    assert_secure_url(provider, url)
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with _OPENER.open(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        detail = (err.read().decode("utf-8", "replace") if err.fp else str(err))[:500]
        raise ProviderError(provider, f"HTTP {err.code}: {detail}", err.code) from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise ProviderError(provider, str(err)) from err


def safe_parse_args(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else {"_raw": raw}
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {}
