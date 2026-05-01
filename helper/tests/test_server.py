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
