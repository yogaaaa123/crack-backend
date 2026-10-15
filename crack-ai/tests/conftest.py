"""
Pytest configuration — sets required env vars BEFORE any app import.

config.py loads Settings at import time and requires DATABASE_URL,
JWT_SECRET, INTERNAL_API_KEY, and LLM_API_KEY. Without these fixtures,
every test importing app modules would crash at collection time.
"""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-unit-tests-only-0123456789abcdef")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-api-key-0123456789abcdef")
os.environ.setdefault("LLM_API_KEY", "sk-or-test-key-for-unit-tests")
os.environ.setdefault("LLM_BASE_URL", "https://openrouter.ai/api/v1")
