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
