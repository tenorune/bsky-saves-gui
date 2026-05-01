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
