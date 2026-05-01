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
