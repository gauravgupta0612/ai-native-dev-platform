"""Small JSON POST helper (standard library only), shared by all HTTP providers."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict

from ..types import ProviderError


def post_json(provider: str, url: str, body: Any, headers: Dict[str, str], timeout: float = 60.0) -> Dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:500]
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
