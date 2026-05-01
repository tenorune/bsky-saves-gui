# Plan 5 — `bsky-saves-gui-helper` Python Package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `bsky-saves-gui-helper`, a minimal stdlib-only Python package that runs a loopback HTTP server accepting `POST /fetch` requests from the static web app and proxying arbitrary article URLs, sidestepping browser CORS restrictions.

**Architecture:** Three focused modules under `helper/src/bsky_saves_gui_helper/`: `fetcher.py` handles outbound URL validation and retrieval with timeout/size-cap guards; `server.py` defines the `BaseHTTPRequestHandler` subclass implementing CORS preflight, `GET /health`, and `POST /fetch`; `cli.py` parses arguments/env vars and starts the server. Tests use `pytest` with an in-process `http.server.HTTPServer` bound to a random loopback port — no external libraries required.

**Tech Stack:** Python 3.10+, stdlib only (`http.server`, `urllib.request`, `urllib.parse`, `base64`, `json`, `argparse`, `threading`), pytest (dev-only), hatchling build backend, PyPI distribution.

**Reference:** [Design spec](../specs/2026-05-01-bsky-saves-gui-design.md), Helper section.

---

## File Structure

This plan creates:

```
helper/
├── pyproject.toml                          # build metadata, console script, dev extras
├── README.md                               # install + run + flags + security notes
├── src/
│   └── bsky_saves_gui_helper/
│       ├── __init__.py                     # package version (__version__)
│       ├── cli.py                          # argument parsing + main() entry point
│       ├── server.py                       # HelperHandler (BaseHTTPRequestHandler subclass)
│       └── fetcher.py                      # fetch_url() with scheme check, timeout, size cap
└── tests/
    ├── conftest.py                         # pytest fixtures: live server on random port
    ├── test_fetcher.py                     # scheme validation, timeout, size cap
    ├── test_server.py                      # CORS preflight, /health, /fetch happy path, deny
    └── test_cli.py                         # arg parsing, env var precedence, --help
```

The `helper/` directory is fully independent of the `app/` web source. Nothing in `app/` imports from `helper/`. CI treats them as separate jobs.

---

## Task 1: Helper directory init — `pyproject.toml`, package skeleton, dev install

**Files:**
- Create: `helper/pyproject.toml`
- Create: `helper/src/bsky_saves_gui_helper/__init__.py`

- [ ] **Step 1: Create the helper directory tree**

Run:
```bash
mkdir -p helper/src/bsky_saves_gui_helper helper/tests
```

- [ ] **Step 2: Create `helper/pyproject.toml`**

Contents:
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "bsky-saves-gui-helper"
version = "0.1.0"
description = "Loopback CORS-proxy helper for bsky-saves-gui: fetches arbitrary article URLs on behalf of the browser."
readme = "README.md"
license = { text = "MIT" }
requires-python = ">=3.10"
dependencies = []

[project.scripts]
bsky-saves-gui-helper = "bsky_saves_gui_helper.cli:main"

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.hatch.build.targets.wheel]
packages = ["src/bsky_saves_gui_helper"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 3: Create `helper/src/bsky_saves_gui_helper/__init__.py`**

Contents:
```python
"""bsky-saves-gui-helper — loopback CORS-proxy for article hydration."""

__version__ = "0.1.0"
```

- [ ] **Step 4: Create stub modules so the package is importable**

Create `helper/src/bsky_saves_gui_helper/fetcher.py`:
```python
"""Outbound URL fetcher with scheme validation, timeout, and body size cap."""
```

Create `helper/src/bsky_saves_gui_helper/server.py`:
```python
"""HTTP request handler: CORS preflight, GET /health, POST /fetch."""
```

Create `helper/src/bsky_saves_gui_helper/cli.py`:
```python
"""CLI entry point: parse arguments and start the loopback server."""
```

- [ ] **Step 5: Install the package in editable mode with dev extras**

Run from the repo root:
```bash
cd helper && pip install -e ".[dev]" && cd ..
```

Expected: `Successfully installed bsky-saves-gui-helper-0.1.0` (or similar). No errors.

- [ ] **Step 6: Verify the console script exists**

Run:
```bash
bsky-saves-gui-helper --help 2>&1 || true
```

Expected: some output (may be an error about `main` not defined — that's fine at this stage). The key is that the command is on `PATH`.

- [ ] **Step 7: Commit**

```bash
git add helper/pyproject.toml helper/src/
git commit -m "chore(helper): scaffold bsky-saves-gui-helper package with pyproject.toml"
```

---

## Task 2: URL fetcher with tests

**Files:**
- Create: `helper/tests/test_fetcher.py`
- Modify: `helper/src/bsky_saves_gui_helper/fetcher.py`

The fetcher's job is narrow: validate that a URL is `http://` or `https://`, optionally check the host against an allow-list, fetch it with a timeout, and cap the response body. It returns a plain dataclass. Error cases raise typed exceptions that `server.py` maps to HTTP status codes.

- [ ] **Step 1: Write the failing tests**

Create `helper/tests/test_fetcher.py`:
```python
"""Tests for bsky_saves_gui_helper.fetcher."""

import base64
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from bsky_saves_gui_helper.fetcher import (
    FetchResult,
    SchemeError,
    HostNotAllowedError,
    SizeLimitExceededError,
    fetch_url,
)


# ---------------------------------------------------------------------------
# Minimal echo server used as the fetch target in happy-path and size tests
# ---------------------------------------------------------------------------

class _EchoHandler(BaseHTTPRequestHandler):
    """Returns a configurable body and status set on the server instance."""

    def log_message(self, *args):  # suppress output during tests
        pass

    def do_GET(self):
        body = self.server.response_body  # type: ignore[attr-defined]
        status = self.server.response_status  # type: ignore[attr-defined]
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _start_echo_server(body: bytes, status: int = 200) -> tuple[HTTPServer, str]:
    server = HTTPServer(("127.0.0.1", 0), _EchoHandler)
    server.response_body = body  # type: ignore[attr-defined]
    server.response_status = status  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    return server, f"http://127.0.0.1:{port}/"


# ---------------------------------------------------------------------------
# Scheme validation
# ---------------------------------------------------------------------------

def test_rejects_file_scheme():
    with pytest.raises(SchemeError, match="file"):
        fetch_url("file:///etc/passwd")


def test_rejects_ftp_scheme():
    with pytest.raises(SchemeError, match="ftp"):
        fetch_url("ftp://example.com/file.txt")


def test_rejects_gopher_scheme():
    with pytest.raises(SchemeError, match="gopher"):
        fetch_url("gopher://example.com/")


def test_rejects_blank_url():
    with pytest.raises(SchemeError):
        fetch_url("")


def test_accepts_http_scheme():
    server, url = _start_echo_server(b"hello")
    try:
        result = fetch_url(url)
        assert result.status == 200
    finally:
        server.shutdown()


def test_accepts_https_scheme_format():
    # We can't make a real TLS connection in unit tests, so just verify the
    # scheme check passes and that a connection error (not SchemeError) is
    # raised for a non-existent host.
    with pytest.raises(Exception) as exc_info:
        fetch_url("https://127.0.0.1:1/")
    assert not isinstance(exc_info.value, SchemeError)


# ---------------------------------------------------------------------------
# Host allow-list
# ---------------------------------------------------------------------------

def test_host_allowlist_permits_listed_host():
    server, url = _start_echo_server(b"ok")
    try:
        result = fetch_url(url, allow_hosts={"127.0.0.1"})
        assert result.status == 200
    finally:
        server.shutdown()


def test_host_allowlist_blocks_unlisted_host():
    with pytest.raises(HostNotAllowedError, match="example.com"):
        fetch_url("http://example.com/", allow_hosts={"trusted.example.net"})


def test_no_allowlist_permits_any_host():
    server, url = _start_echo_server(b"ok")
    try:
        result = fetch_url(url, allow_hosts=None)
        assert result.status == 200
    finally:
        server.shutdown()


# ---------------------------------------------------------------------------
# FetchResult shape
# ---------------------------------------------------------------------------

def test_fetch_result_body_is_base64():
    payload = b"hello world"
    server, url = _start_echo_server(payload)
    try:
        result = fetch_url(url)
        assert base64.b64decode(result.body_b64) == payload
    finally:
        server.shutdown()


def test_fetch_result_includes_status_and_headers():
    server, url = _start_echo_server(b"x", status=202)
    try:
        result = fetch_url(url)
        assert result.status == 202
        assert isinstance(result.headers, dict)
    finally:
        server.shutdown()


# ---------------------------------------------------------------------------
# Size cap
# ---------------------------------------------------------------------------

def test_size_cap_raises_when_exceeded():
    large_body = b"x" * 200
    server, url = _start_echo_server(large_body)
    try:
        with pytest.raises(SizeLimitExceededError):
            fetch_url(url, max_bytes=100)
    finally:
        server.shutdown()


def test_size_cap_allows_body_at_limit():
    body = b"x" * 100
    server, url = _start_echo_server(body)
    try:
        result = fetch_url(url, max_bytes=100)
        assert base64.b64decode(result.body_b64) == body
    finally:
        server.shutdown()


# ---------------------------------------------------------------------------
# Timeout
# ---------------------------------------------------------------------------

def test_timeout_raises_on_slow_server():
    """A server that delays its response should cause a timeout."""

    class _SlowHandler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            time.sleep(5)  # longer than the test timeout
            self.send_response(200)
            self.end_headers()

    slow_server = HTTPServer(("127.0.0.1", 0), _SlowHandler)
    port = slow_server.server_address[1]
    thread = threading.Thread(target=slow_server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(Exception):  # socket.timeout or urllib.error.URLError
            fetch_url(f"http://127.0.0.1:{port}/", timeout=0.2)
    finally:
        slow_server.shutdown()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd helper && python -m pytest tests/test_fetcher.py -v 2>&1 | head -30
```

Expected: FAIL — `ImportError: cannot import name 'FetchResult' from 'bsky_saves_gui_helper.fetcher'`.

- [ ] **Step 3: Implement `helper/src/bsky_saves_gui_helper/fetcher.py`**

Contents:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd helper && python -m pytest tests/test_fetcher.py -v
```

Expected: PASS — all tests green. (The `test_accepts_https_scheme_format` test passes because the connection error is not a `SchemeError`.)

- [ ] **Step 5: Commit**

```bash
git add helper/src/bsky_saves_gui_helper/fetcher.py helper/tests/test_fetcher.py
git commit -m "feat(helper): URL fetcher with scheme validation, host allow-list, timeout, size cap"
```

---

## Task 3: HTTP server and handler with tests

**Files:**
- Create: `helper/tests/conftest.py`
- Create: `helper/tests/test_server.py`
- Modify: `helper/src/bsky_saves_gui_helper/server.py`

The handler responds to `OPTIONS` (CORS preflight), `GET /health`, and `POST /fetch`. It delegates outbound fetching to `fetch_url()` from `fetcher.py`. CORS origin validation happens in every response path.

- [ ] **Step 1: Create `helper/tests/conftest.py`**

Contents:
```python
"""Shared pytest fixtures for helper tests."""

from __future__ import annotations

import json
import threading
import urllib.request
from http.server import HTTPServer
from typing import Generator

import pytest

from bsky_saves_gui_helper.server import make_handler


@pytest.fixture()
def server_factory():
    """Return a factory that starts a live HelperHandler server on a random port.

    Usage::

        def test_foo(server_factory):
            srv, url = server_factory(allow_origins={"http://example.com"})
            # ... make requests to url ...
    """
    servers: list[HTTPServer] = []

    def _make(
        allow_origins: set[str] | None = None,
        allow_hosts: set[str] | None = None,
        max_bytes: int = 10 * 1024 * 1024,
        timeout: float = 20.0,
    ) -> tuple[HTTPServer, str]:
        if allow_origins is None:
            allow_origins = {"https://saves.lightseed.net", "http://localhost:5173"}
        handler_cls = make_handler(
            allow_origins=allow_origins,
            allow_hosts=allow_hosts,
            max_bytes=max_bytes,
            timeout=timeout,
        )
        srv = HTTPServer(("127.0.0.1", 0), handler_cls)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        servers.append(srv)
        port = srv.server_address[1]
        return srv, f"http://127.0.0.1:{port}"

    yield _make

    for srv in servers:
        srv.shutdown()
```

- [ ] **Step 2: Write the failing server tests**

Create `helper/tests/test_server.py`:
```python
"""Tests for bsky_saves_gui_helper.server (HelperHandler)."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

from bsky_saves_gui_helper import __version__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(url: str, headers: dict[str, str] | None = None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req) as resp:
        return resp.status, dict(resp.headers), resp.read()


def _post_json(url: str, payload: dict, headers: dict[str, str] | None = None):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), json.loads(exc.read())


def _options(url: str, headers: dict[str, str]):
    req = urllib.request.Request(url, headers=headers, method="OPTIONS")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


# ---------------------------------------------------------------------------
# Echo server fixture (target for /fetch happy-path tests)
# ---------------------------------------------------------------------------

class _EchoHandler:
    """Minimal inline handler — defined per-test via closure."""
    pass


def _start_target(body: bytes, status: int = 200):
    from http.server import BaseHTTPRequestHandler

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = HTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    port = srv.server_address[1]
    return srv, f"http://127.0.0.1:{port}/"


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

def test_health_returns_ok(server_factory):
    _, base_url = server_factory()
    status, _, body = _get(f"{base_url}/health")
    assert status == 200
    data = json.loads(body)
    assert data["ok"] is True
    assert data["version"] == __version__


def test_health_cors_header_for_allowed_origin(server_factory):
    origin = "http://localhost:5173"
    _, base_url = server_factory(allow_origins={origin})
    status, headers, _ = _get(f"{base_url}/health", headers={"Origin": origin})
    assert status == 200
    assert headers.get("Access-Control-Allow-Origin") == origin


def test_health_no_cors_header_for_denied_origin(server_factory):
    _, base_url = server_factory(allow_origins={"http://localhost:5173"})
    status, headers, _ = _get(
        f"{base_url}/health", headers={"Origin": "https://evil.example.com"}
    )
    # Server still responds 200, but omits the CORS header
    assert status == 200
    assert "Access-Control-Allow-Origin" not in headers


# ---------------------------------------------------------------------------
# OPTIONS preflight
# ---------------------------------------------------------------------------

def test_preflight_allowed_origin(server_factory):
    origin = "https://saves.lightseed.net"
    _, base_url = server_factory(allow_origins={origin})
    status, headers, _ = _options(
        f"{base_url}/fetch",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert status == 204
    assert headers.get("Access-Control-Allow-Origin") == origin
    assert "POST" in headers.get("Access-Control-Allow-Methods", "")


def test_preflight_denied_origin(server_factory):
    _, base_url = server_factory(allow_origins={"https://saves.lightseed.net"})
    status, headers, _ = _options(
        f"{base_url}/fetch",
        headers={
            "Origin": "https://attacker.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers


# ---------------------------------------------------------------------------
# POST /fetch — happy path
# ---------------------------------------------------------------------------

def test_fetch_happy_path(server_factory):
    target_srv, target_url = _start_target(b"hello article")
    _, base_url = server_factory()
    try:
        status, _, data = _post_json(
            f"{base_url}/fetch",
            {"url": target_url},
            headers={"Origin": "http://localhost:5173"},
        )
        assert status == 200
        assert data["status"] == 200
        import base64
        assert base64.b64decode(data["body_b64"]) == b"hello article"
        assert isinstance(data["headers"], dict)
    finally:
        target_srv.shutdown()


# ---------------------------------------------------------------------------
# POST /fetch — error paths
# ---------------------------------------------------------------------------

def test_fetch_rejects_non_http_scheme(server_factory):
    _, base_url = server_factory()
    status, _, data = _post_json(
        f"{base_url}/fetch",
        {"url": "file:///etc/passwd"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert status == 400
    assert "error" in data


def test_fetch_rejects_missing_url_key(server_factory):
    _, base_url = server_factory()
    status, _, data = _post_json(
        f"{base_url}/fetch",
        {"not_url": "http://example.com"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert status == 400
    assert "error" in data


def test_fetch_rejects_non_json_body(server_factory):
    _, base_url = server_factory()
    req = urllib.request.Request(
        f"{base_url}/fetch",
        data=b"not json",
        headers={
            "Content-Type": "application/json",
            "Origin": "http://localhost:5173",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        status = exc.code
        data = json.loads(exc.read())
    assert status == 400
    assert "error" in data


def test_fetch_denied_origin_gets_403(server_factory):
    _, base_url = server_factory(allow_origins={"https://saves.lightseed.net"})
    status, _, data = _post_json(
        f"{base_url}/fetch",
        {"url": "http://example.com/"},
        headers={"Origin": "https://evil.example.com"},
    )
    assert status == 403
    assert "error" in data


def test_fetch_host_not_in_allowlist(server_factory):
    _, base_url = server_factory(allow_hosts={"trusted.example.net"})
    status, _, data = _post_json(
        f"{base_url}/fetch",
        {"url": "http://untrusted.example.com/"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert status == 403
    assert "error" in data


def test_fetch_size_cap_exceeded(server_factory):
    large_body = b"x" * 200
    target_srv, target_url = _start_target(large_body)
    _, base_url = server_factory(max_bytes=100)
    try:
        status, _, data = _post_json(
            f"{base_url}/fetch",
            {"url": target_url},
            headers={"Origin": "http://localhost:5173"},
        )
        assert status == 502
        assert "error" in data
    finally:
        target_srv.shutdown()


def test_unknown_path_returns_404(server_factory):
    _, base_url = server_factory()
    try:
        _get(f"{base_url}/nonexistent")
        assert False, "Expected HTTPError"
    except urllib.error.HTTPError as exc:
        assert exc.code == 404
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
cd helper && python -m pytest tests/test_server.py -v 2>&1 | head -30
```

Expected: FAIL — `ImportError: cannot import name 'make_handler'` (or similar).

- [ ] **Step 4: Implement `helper/src/bsky_saves_gui_helper/server.py`**

Contents:
```python
"""HTTP request handler: CORS preflight, GET /health, POST /fetch."""

from __future__ import annotations

import json
import traceback
import urllib.error
from http.server import BaseHTTPRequestHandler
from typing import Optional

from bsky_saves_gui_helper import __version__
from bsky_saves_gui_helper.fetcher import (
    DEFAULT_MAX_BYTES,
    DEFAULT_TIMEOUT,
    HostNotAllowedError,
    SchemeError,
    SizeLimitExceededError,
    fetch_url,
)

_CORS_ALLOW_METHODS = "POST, GET, OPTIONS"
_CORS_ALLOW_HEADERS = "Content-Type"
_CORS_MAX_AGE = "86400"


def make_handler(
    allow_origins: set[str],
    allow_hosts: Optional[set[str]] = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout: float = DEFAULT_TIMEOUT,
) -> type[BaseHTTPRequestHandler]:
    """Return a handler class configured with the given CORS and fetch settings.

    Using a factory avoids global state: each server gets its own closure.
    """

    class HelperHandler(BaseHTTPRequestHandler):
        # ------------------------------------------------------------------
        # Logging
        # ------------------------------------------------------------------

        def log_message(self, fmt: str, *args: object) -> None:  # type: ignore[override]
            # Delegate to print so output is visible but can be suppressed.
            import sys
            print(f"[helper] {self.address_string()} - {fmt % args}", file=sys.stderr)

        # ------------------------------------------------------------------
        # CORS helpers
        # ------------------------------------------------------------------

        def _origin(self) -> str:
            return self.headers.get("Origin", "")

        def _origin_allowed(self) -> bool:
            return self._origin() in allow_origins

        def _send_cors_headers(self) -> None:
            origin = self._origin()
            if origin in allow_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        # ------------------------------------------------------------------
        # Response helpers
        # ------------------------------------------------------------------

        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _send_error_json(self, status: int, message: str) -> None:
            self._send_json(status, {"error": message})

        # ------------------------------------------------------------------
        # OPTIONS — CORS preflight
        # ------------------------------------------------------------------

        def do_OPTIONS(self) -> None:
            if not self._origin_allowed():
                self._send_error_json(403, "Origin not allowed.")
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self._origin())
            self.send_header("Access-Control-Allow-Methods", _CORS_ALLOW_METHODS)
            self.send_header("Access-Control-Allow-Headers", _CORS_ALLOW_HEADERS)
            self.send_header("Access-Control-Max-Age", _CORS_MAX_AGE)
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()

        # ------------------------------------------------------------------
        # GET /health
        # ------------------------------------------------------------------

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send_json(200, {"ok": True, "version": __version__})
            else:
                self._send_error_json(404, f"Not found: {self.path}")

        # ------------------------------------------------------------------
        # POST /fetch
        # ------------------------------------------------------------------

        def do_POST(self) -> None:
            if self.path != "/fetch":
                self._send_error_json(404, f"Not found: {self.path}")
                return

            # Origin check for non-preflight requests too.
            if not self._origin_allowed():
                self._send_error_json(403, "Origin not allowed.")
                return

            # Parse body.
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                self._send_error_json(400, f"Invalid JSON body: {exc}")
                return

            url = payload.get("url")
            if not isinstance(url, str) or not url:
                self._send_error_json(400, "Missing or invalid 'url' field in request body.")
                return

            # Fetch.
            try:
                result = fetch_url(
                    url,
                    allow_hosts=allow_hosts,
                    timeout=timeout,
                    max_bytes=max_bytes,
                )
            except SchemeError as exc:
                self._send_error_json(400, str(exc))
            except HostNotAllowedError as exc:
                self._send_error_json(403, str(exc))
            except SizeLimitExceededError as exc:
                self._send_error_json(502, str(exc))
            except urllib.error.URLError as exc:
                self._send_error_json(502, f"Upstream fetch failed: {exc.reason}")
            except Exception as exc:
                self._send_error_json(500, f"Internal error: {exc}")
            else:
                self._send_json(200, {
                    "status": result.status,
                    "headers": result.headers,
                    "body_b64": result.body_b64,
                })

    return HelperHandler
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd helper && python -m pytest tests/test_server.py -v
```

Expected: PASS — all tests green.

- [ ] **Step 6: Run all tests so far**

Run:
```bash
cd helper && python -m pytest tests/ -v
```

Expected: PASS — all fetcher and server tests green.

- [ ] **Step 7: Commit**

```bash
git add helper/src/bsky_saves_gui_helper/server.py helper/tests/conftest.py helper/tests/test_server.py
git commit -m "feat(helper): HTTP handler with CORS preflight, /health, and /fetch endpoints"
```

---

## Task 4: CLI with argument parsing and tests

**Files:**
- Create: `helper/tests/test_cli.py`
- Modify: `helper/src/bsky_saves_gui_helper/cli.py`

The CLI parses flags and env vars, validates the bind address, then starts the server. Tests exercise argument precedence and `--help` without starting a live server.

- [ ] **Step 1: Write the failing CLI tests**

Create `helper/tests/test_cli.py`:
```python
"""Tests for bsky_saves_gui_helper.cli argument parsing."""

from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

import pytest

from bsky_saves_gui_helper.cli import build_config, HelperConfig


# ---------------------------------------------------------------------------
# HelperConfig defaults
# ---------------------------------------------------------------------------

def test_defaults():
    cfg = build_config([])
    assert cfg.port == 7878
    assert cfg.allow_origins == {"https://saves.lightseed.net", "http://localhost:5173"}
    assert cfg.allow_hosts is None
    assert cfg.timeout == 20.0
    assert cfg.max_bytes == 10 * 1024 * 1024


# ---------------------------------------------------------------------------
# --port flag
# ---------------------------------------------------------------------------

def test_port_flag():
    cfg = build_config(["--port", "9090"])
    assert cfg.port == 9090


def test_port_env_var(monkeypatch):
    monkeypatch.setenv("HELPER_PORT", "8888")
    cfg = build_config([])
    assert cfg.port == 8888


def test_port_flag_beats_env_var(monkeypatch):
    monkeypatch.setenv("HELPER_PORT", "8888")
    cfg = build_config(["--port", "9999"])
    assert cfg.port == 9999


# ---------------------------------------------------------------------------
# --allow-origin flag
# ---------------------------------------------------------------------------

def test_allow_origin_flag_replaces_defaults():
    cfg = build_config(["--allow-origin", "https://myapp.example.com"])
    assert cfg.allow_origins == {"https://myapp.example.com"}


def test_allow_origin_flag_repeatable():
    cfg = build_config([
        "--allow-origin", "https://a.example.com",
        "--allow-origin", "https://b.example.com",
    ])
    assert cfg.allow_origins == {"https://a.example.com", "https://b.example.com"}


def test_allow_origin_env_var(monkeypatch):
    monkeypatch.setenv("HELPER_ALLOW_ORIGIN", "https://env.example.com")
    cfg = build_config([])
    assert cfg.allow_origins == {"https://env.example.com"}


def test_allow_origin_env_var_space_separated(monkeypatch):
    monkeypatch.setenv(
        "HELPER_ALLOW_ORIGIN",
        "https://a.example.com https://b.example.com",
    )
    cfg = build_config([])
    assert cfg.allow_origins == {"https://a.example.com", "https://b.example.com"}


def test_allow_origin_flag_beats_env_var(monkeypatch):
    monkeypatch.setenv("HELPER_ALLOW_ORIGIN", "https://env.example.com")
    cfg = build_config(["--allow-origin", "https://flag.example.com"])
    assert cfg.allow_origins == {"https://flag.example.com"}


# ---------------------------------------------------------------------------
# --allow-host flag
# ---------------------------------------------------------------------------

def test_allow_host_default_is_none():
    cfg = build_config([])
    assert cfg.allow_hosts is None


def test_allow_host_flag():
    cfg = build_config(["--allow-host", "trusted.example.com"])
    assert cfg.allow_hosts == {"trusted.example.com"}


def test_allow_host_flag_repeatable():
    cfg = build_config([
        "--allow-host", "a.example.com",
        "--allow-host", "b.example.com",
    ])
    assert cfg.allow_hosts == {"a.example.com", "b.example.com"}


def test_allow_host_env_var(monkeypatch):
    monkeypatch.setenv("HELPER_ALLOW_HOST", "trusted.example.com")
    cfg = build_config([])
    assert cfg.allow_hosts == {"trusted.example.com"}


def test_allow_host_env_var_space_separated(monkeypatch):
    monkeypatch.setenv("HELPER_ALLOW_HOST", "a.example.com b.example.com")
    cfg = build_config([])
    assert cfg.allow_hosts == {"a.example.com", "b.example.com"}


# ---------------------------------------------------------------------------
# --help smoke test
# ---------------------------------------------------------------------------

def test_help_exits_cleanly():
    with pytest.raises(SystemExit) as exc_info:
        build_config(["--help"])
    assert exc_info.value.code == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd helper && python -m pytest tests/test_cli.py -v 2>&1 | head -20
```

Expected: FAIL — `ImportError: cannot import name 'build_config'`.

- [ ] **Step 3: Implement `helper/src/bsky_saves_gui_helper/cli.py`**

Contents:
```python
"""CLI entry point: parse arguments and start the loopback server."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from http.server import HTTPServer
from typing import Optional

from bsky_saves_gui_helper.fetcher import DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT
from bsky_saves_gui_helper.server import make_handler

_DEFAULT_ALLOW_ORIGINS = {"https://saves.lightseed.net", "http://localhost:5173"}
_DEFAULT_PORT = 7878
_LOOPBACK = "127.0.0.1"


# ---------------------------------------------------------------------------
# Configuration dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HelperConfig:
    port: int
    allow_origins: set[str]
    allow_hosts: Optional[set[str]]
    timeout: float
    max_bytes: int


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bsky-saves-gui-helper",
        description=(
            "Loopback CORS-proxy for bsky-saves-gui. "
            "Runs on 127.0.0.1 only and fetches article URLs on behalf of the browser."
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        metavar="PORT",
        help=f"Port to bind (env: HELPER_PORT, default: {_DEFAULT_PORT}).",
    )
    parser.add_argument(
        "--allow-origin",
        dest="allow_origins",
        action="append",
        default=None,
        metavar="ORIGIN",
        help=(
            "Allow this origin in CORS responses. Repeatable. "
            "Overrides defaults when specified. "
            "(env: HELPER_ALLOW_ORIGIN, space-separated)"
        ),
    )
    parser.add_argument(
        "--allow-host",
        dest="allow_hosts",
        action="append",
        default=None,
        metavar="HOST",
        help=(
            "Restrict outbound fetches to this hostname. Repeatable. "
            "Default: no restriction. "
            "(env: HELPER_ALLOW_HOST, space-separated)"
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        metavar="SECONDS",
        help=f"Outbound fetch timeout in seconds (default: {DEFAULT_TIMEOUT}).",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        metavar="BYTES",
        help=f"Maximum response body size in bytes (default: {DEFAULT_MAX_BYTES}).",
    )
    return parser


def build_config(argv: list[str]) -> HelperConfig:
    """Parse *argv* and environment variables into a :class:`HelperConfig`.

    CLI flags take precedence over environment variables, which take
    precedence over built-in defaults.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    # --- Port --------------------------------------------------------------
    port: int
    if args.port is not None:
        port = args.port
    elif (env_port := os.environ.get("HELPER_PORT")):
        port = int(env_port)
    else:
        port = _DEFAULT_PORT

    # --- Allow-origins -----------------------------------------------------
    allow_origins: set[str]
    if args.allow_origins is not None:
        # Flag was supplied at least once — use the flag values.
        allow_origins = set(args.allow_origins)
    elif (env_origins := os.environ.get("HELPER_ALLOW_ORIGIN")):
        allow_origins = set(env_origins.split())
    else:
        allow_origins = set(_DEFAULT_ALLOW_ORIGINS)

    # --- Allow-hosts -------------------------------------------------------
    allow_hosts: Optional[set[str]]
    if args.allow_hosts is not None:
        allow_hosts = set(args.allow_hosts)
    elif (env_hosts := os.environ.get("HELPER_ALLOW_HOST")):
        allow_hosts = set(env_hosts.split())
    else:
        allow_hosts = None

    return HelperConfig(
        port=port,
        allow_origins=allow_origins,
        allow_hosts=allow_hosts,
        timeout=args.timeout,
        max_bytes=args.max_bytes,
    )


# ---------------------------------------------------------------------------
# Server start
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    if argv is None:
        argv = sys.argv[1:]

    cfg = build_config(argv)

    handler_cls = make_handler(
        allow_origins=cfg.allow_origins,
        allow_hosts=cfg.allow_hosts,
        max_bytes=cfg.max_bytes,
        timeout=cfg.timeout,
    )

    server = HTTPServer((_LOOPBACK, cfg.port), handler_cls)
    print(
        f"bsky-saves-gui-helper listening on http://{_LOOPBACK}:{cfg.port}/",
        flush=True,
    )
    print(f"  CORS allow-origins : {sorted(cfg.allow_origins)}", flush=True)
    if cfg.allow_hosts:
        print(f"  Outbound allow-hosts: {sorted(cfg.allow_hosts)}", flush=True)
    else:
        print("  Outbound allow-hosts: (none — all article hosts permitted)", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
    finally:
        server.server_close()
```

- [ ] **Step 4: Run the CLI tests to verify they pass**

Run:
```bash
cd helper && python -m pytest tests/test_cli.py -v
```

Expected: PASS — all tests green.

- [ ] **Step 5: Verify the console script starts and --help works**

Run:
```bash
bsky-saves-gui-helper --help
```

Expected: usage text listing `--port`, `--allow-origin`, `--allow-host`, `--timeout`, `--max-bytes`.

- [ ] **Step 6: Run the full test suite**

Run:
```bash
cd helper && python -m pytest tests/ -v
```

Expected: PASS — all fetcher, server, and CLI tests green.

- [ ] **Step 7: Commit**

```bash
git add helper/src/bsky_saves_gui_helper/cli.py helper/tests/test_cli.py
git commit -m "feat(helper): CLI with --port, --allow-origin, --allow-host, env var precedence"
```

---

## Task 5: `helper/README.md`

**Files:**
- Create: `helper/README.md`

- [ ] **Step 1: Write `helper/README.md`**

Contents:
```markdown
# bsky-saves-gui-helper

A tiny stdlib-only Python helper that runs a loopback HTTP server on `127.0.0.1` so the [bsky-saves-gui](https://github.com/tenorune/bsky-saves-gui) web app can fetch arbitrary article URLs without being blocked by browser CORS restrictions.

## Install

```bash
pipx install bsky-saves-gui-helper
```

Or with plain pip into a virtual environment:

```bash
pip install bsky-saves-gui-helper
```

Requires **Python 3.10 or later**. No extra dependencies — pure stdlib.

## Run

```bash
bsky-saves-gui-helper
```

The server binds to `127.0.0.1:7878` by default and prints the active configuration on startup. Press Ctrl-C to stop.

## Flags

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port PORT` | `HELPER_PORT` | `7878` | Loopback port to bind |
| `--allow-origin ORIGIN` | `HELPER_ALLOW_ORIGIN` | `https://saves.lightseed.net` and `http://localhost:5173` | Permitted CORS origins. Repeatable. Env var accepts space-separated values. |
| `--allow-host HOST` | `HELPER_ALLOW_HOST` | _(none — all article hosts allowed)_ | Restrict outbound fetches to these hostnames. Repeatable. Env var accepts space-separated values. |
| `--timeout SECONDS` | — | `20` | Socket timeout for outbound article fetches |
| `--max-bytes BYTES` | — | `10485760` (10 MB) | Maximum response body size |

CLI flags take precedence over env vars, which take precedence over built-in defaults.

### Examples

Self-hosted instance on a different domain:

```bash
bsky-saves-gui-helper --allow-origin https://mysaves.example.com
```

Development against a local Vite dev server:

```bash
bsky-saves-gui-helper --allow-origin http://localhost:5173
```

Restrict which article sites can be fetched:

```bash
bsky-saves-gui-helper --allow-host www.bbc.com --allow-host www.theguardian.com
```

## Endpoints

### `GET /health`

Returns:

```json
{"ok": true, "version": "0.1.0"}
```

### `POST /fetch`

Request body (JSON):

```json
{"url": "https://www.example.com/article"}
```

Success response (JSON):

```json
{
  "status": 200,
  "headers": {"Content-Type": "text/html; charset=utf-8"},
  "body_b64": "<base64-encoded response body>"
}
```

Error response (JSON):

```json
{"error": "Unsupported URL scheme 'file'; only http and https are allowed."}
```

HTTP status codes:
- `200` — successful fetch (the upstream status is in the JSON payload)
- `400` — bad request (invalid JSON body, missing `url`, disallowed URL scheme)
- `403` — origin not in CORS allow-list, or target host not in `--allow-host` list
- `404` — unknown path
- `502` — upstream fetch failed or response body too large
- `500` — unexpected internal error

## Security notes

- **Loopback-only.** The server binds to `127.0.0.1` and will not accept connections from any other interface. It is not a network proxy.
- **CORS allow-list.** Every response path checks the `Origin` header against the configured allow-list. Requests from unlisted origins receive `403`. The default allow-list contains only the reference deployment origin and the Vite dev server.
- **URL scheme validation.** Only `http://` and `https://` URLs are accepted. `file://`, `ftp://`, `gopher://`, and all other schemes are rejected with `400`.
- **Outbound host allow-list (optional).** `--allow-host` lets you restrict which article domains the helper will contact. Unlisted hosts receive `403`.
- **Body size cap.** Responses larger than `--max-bytes` (default 10 MB) are truncated and the request returns `502`.
- **Fetch timeout.** Outbound requests time out after `--timeout` seconds (default 20 s).

## Self-host configuration

If you deploy the web app under your own domain, pass your domain as the allowed origin:

```bash
bsky-saves-gui-helper --allow-origin https://YOUR_DOMAIN
```

The `VITE_HELPER_ORIGIN` build variable in the web app controls which loopback address and port the app probes for the helper. If you change `--port`, update `VITE_HELPER_ORIGIN` in your deployment.

## License

MIT — see [LICENSE](../LICENSE) at the repo root.
```

- [ ] **Step 2: Commit**

```bash
git add helper/README.md
git commit -m "docs(helper): add README with install, flags, endpoints, and security notes"
```

---

## Task 6: CI workflow for the helper

**Files:**
- Create: `.github/workflows/helper-ci.yml`

This workflow runs independently of the web-app CI. It tests the helper on every push that touches `helper/**` and on every pull request.

- [ ] **Step 1: Create `.github/workflows/helper-ci.yml`**

Contents:
```yaml
name: helper-ci

on:
  pull_request:
  push:
    branches: [main]
    paths:
      - "helper/**"
      - ".github/workflows/helper-ci.yml"

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install helper with dev extras
        run: pip install -e "helper/[dev]"

      - name: Run tests
        run: python -m pytest helper/tests/ -v

      - name: Verify console script is on PATH
        run: bsky-saves-gui-helper --help
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/helper-ci.yml
git commit -m "ci(helper): test on Python 3.10/3.11/3.12 on push and PRs"
```

---

## Final verification

- [ ] **Step 1: Run the complete test suite**

Run:
```bash
cd helper && python -m pytest tests/ -v
```

Expected: PASS — all tests green across `test_fetcher.py`, `test_server.py`, `test_cli.py`.

- [ ] **Step 2: Verify the package builds cleanly**

Run:
```bash
cd helper && pip install build && python -m build --wheel . 2>&1 | tail -5
```

Expected: `Successfully built bsky_saves_gui_helper-0.1.0-py3-none-any.whl` (or similar, no errors).

- [ ] **Step 3: Smoke-test the installed console script**

Run:
```bash
bsky-saves-gui-helper --help
```

Expected: usage text with all documented flags.

- [ ] **Step 4: Final commit if anything changed during verification**

If steps 1–3 surfaced fixes:
```bash
git add -A
git commit -m "fix(helper): address verification findings"
```

---

## Done criteria

After this plan, the following should all be true:

1. `pip install -e "helper/[dev]" && python -m pytest helper/tests/` passes on Python 3.10, 3.11, and 3.12.
2. `bsky-saves-gui-helper --help` prints usage including `--port`, `--allow-origin`, `--allow-host`, `--timeout`, `--max-bytes`.
3. `bsky-saves-gui-helper` starts a server on `127.0.0.1:7878`; `curl http://127.0.0.1:7878/health` returns `{"ok": true, "version": "0.1.0"}`.
4. `POST /fetch` with a valid `http://` or `https://` URL returns `{"status": ..., "headers": {...}, "body_b64": "..."}`.
5. `POST /fetch` with a `file://` URL returns HTTP 400.
6. A request from an unlisted `Origin` to `POST /fetch` returns HTTP 403.
7. `python -m build --wheel helper/` produces a distributable wheel with no errors.
8. The `helper-ci.yml` workflow runs on push to `main` when `helper/**` changes.
9. `helper/README.md` documents all flags, endpoints, and security constraints.

Plan 6 will add the Cloudflare Worker proxy template under `templates/cf-worker/`.
