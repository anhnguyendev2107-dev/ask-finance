"""Centralised config for the Ask Finance prototype."""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR     = PROJECT_ROOT / "data"
OUTPUT_DIR   = PROJECT_ROOT / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

# LLM — defaults to Anthropic Claude. Override via env vars.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic")      # anthropic | openai | mock
LLM_MODEL    = os.getenv("LLM_MODEL",    "claude-sonnet-4-6")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "2048"))

# Agent loop caps
MAX_TOOL_ITERATIONS = 8

# Audit log
AUDIT_LOG_PATH = OUTPUT_DIR / "audit_log.jsonl"
