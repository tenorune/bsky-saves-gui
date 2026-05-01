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
