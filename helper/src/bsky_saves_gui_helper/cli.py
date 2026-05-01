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
