"""Outbound URL fetcher with scheme validation, timeout, and body size cap."""

from __future__ import annotations

import base64
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class FetchError(Exception):
    """Base class for fetch-level errors."""


class SchemeError(FetchError):
    """Raised when the URL scheme is not http or https."""


class HostNotAllowedError(FetchError):
    """Raised when the target host is not in the configured allow-list."""


class SizeLimitExceededError(FetchError):
    """Raised when the response body exceeds the configured size cap."""


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class FetchResult:
    status: int
    headers: dict[str, str]
    body_b64: str  # base64-encoded response body


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_TIMEOUT = 20       # seconds
DEFAULT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def fetch_url(
    url: str,
    *,
    allow_hosts: Optional[set[str]] = None,
    timeout: float = DEFAULT_TIMEOUT,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> FetchResult:
    """Fetch *url* and return a :class:`FetchResult`.

    Parameters
    ----------
    url:
        The URL to fetch. Must use ``http`` or ``https`` scheme.
    allow_hosts:
        If provided, the URL's hostname must be a member of this set.
        Pass ``None`` (the default) to allow any host.
    timeout:
        Socket timeout in seconds for the outbound request.
    max_bytes:
        Maximum number of bytes to read from the response body.
        Raises :class:`SizeLimitExceededError` if exceeded.
    """
    # --- Scheme validation -------------------------------------------------
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise SchemeError(
            f"Unsupported URL scheme {parsed.scheme!r}; only http and https are allowed."
        )

    # --- Host allow-list ---------------------------------------------------
    if allow_hosts is not None:
        hostname = parsed.hostname or ""
        if hostname not in allow_hosts:
            raise HostNotAllowedError(
                f"Host {hostname!r} is not in the configured allow-list."
            )

    # --- Fetch -------------------------------------------------------------
    req = urllib.request.Request(url, headers={"User-Agent": "bsky-saves-gui-helper/1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status: int = resp.status
        raw_headers: dict[str, str] = dict(resp.headers.items())

        # Read up to max_bytes + 1 so we can detect overflow.
        body = resp.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise SizeLimitExceededError(
                f"Response body exceeds the {max_bytes}-byte limit."
            )

    return FetchResult(
        status=status,
        headers=raw_headers,
        body_b64=base64.b64encode(body).decode("ascii"),
    )
