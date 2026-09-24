"""Behavioural test: the worker's cleanup step must use the OpenAI cleanup
client (gpt-5-nano via OPENAI_API_KEY), and must not reference Kimi or
OpenRouter anywhere.

This guards the Kimi -> OpenAI migration: the Kimi API key was deleted and
the operator asked for the Telegram bot to clean up transcripts the same
way the streaming-dictation backend does (direct OpenAI API call, same
OPENAI_API_KEY key-fetching mechanism).
"""

import os
import sys

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test_token_12345")
os.environ.setdefault("OPENAI_API_KEY", "test_openai_key_12345")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_worker_tasks_imports_openai_cleanup_client():
    import importlib
    import worker.tasks as worker_tasks
    importlib.reload(worker_tasks)

    assert hasattr(worker_tasks, "OpenAICleanupClient"), (
        "worker.tasks must import OpenAICleanupClient for transcript cleanup"
    )


def test_worker_tasks_does_not_reference_kimi_or_openrouter():
    import worker.tasks as worker_tasks

    assert not hasattr(worker_tasks, "KimiClient")
    assert not hasattr(worker_tasks, "KimiError")
    assert not hasattr(worker_tasks, "OpenRouterClient")
    assert not hasattr(worker_tasks, "OpenRouterError")


def test_worker_tasks_source_has_no_kimi_or_openrouter_strings():
    import inspect
    import worker.tasks as worker_tasks

    source = inspect.getsource(worker_tasks)
    assert "kimi" not in source.lower(), "worker/tasks.py must not reference Kimi"
    assert "openrouter" not in source.lower(), "worker/tasks.py must not reference OpenRouter"


def test_shared_package_does_not_export_openrouter():
    """The unused OpenRouter client module was removed; the shared package
    must no longer import or export it."""
    import importlib
    import inspect
    import shared

    importlib.reload(shared)

    assert not hasattr(shared, "OpenRouterClient"), (
        "shared must not export OpenRouterClient (module removed)"
    )
    assert not hasattr(shared, "OpenRouterError"), (
        "shared must not export OpenRouterError (module removed)"
    )

    init_source = inspect.getsource(shared)
    assert "openrouter" not in init_source.lower(), (
        "shared/__init__.py must not reference OpenRouter"
    )


@pytest.mark.asyncio
async def test_process_voice_note_uses_openai_cleanup_client(monkeypatch):
    """process_voice_note must instantiate OpenAICleanupClient for cleanup,
    not any Kimi/OpenRouter client."""
    import worker.tasks as worker_tasks
    from unittest.mock import AsyncMock, MagicMock, patch

    monkeypatch.setattr(worker_tasks, "TELEGRAM_BOT_TOKEN", "test_token_12345")

    fake_cleanup_instance = MagicMock()
    fake_cleanup_instance.cleanup_transcript = AsyncMock(return_value="cleaned text")
    fake_cleanup_instance.close = AsyncMock()
    fake_cleanup_client_cls = MagicMock(return_value=fake_cleanup_instance)

    fake_telegram_instance = MagicMock()
    fake_telegram_instance.get_file = AsyncMock(return_value={"file_path": "voice/file.oga", "file_size": 1000})
    fake_telegram_instance.download_file = AsyncMock(return_value=b"fake-audio-bytes")
    fake_telegram_instance.send_message = AsyncMock(return_value={"ok": True})
    fake_telegram_instance.close = AsyncMock()
    fake_telegram_client_cls = MagicMock(return_value=fake_telegram_instance)

    with patch.object(worker_tasks, "OpenAICleanupClient", fake_cleanup_client_cls), \
         patch.object(worker_tasks, "TelegramClient", fake_telegram_client_cls), \
         patch.object(worker_tasks, "_transcribe_with_whisper", return_value="raw transcript text"):
        result = worker_tasks.process_voice_note(file_id="abc123", chat_id=999)

    assert result["success"] is True
    fake_cleanup_client_cls.assert_called_once_with()
    fake_cleanup_instance.cleanup_transcript.assert_awaited_once_with("raw transcript text")
    fake_telegram_instance.send_message.assert_awaited_once()
    _, kwargs = fake_telegram_instance.send_message.call_args
    assert kwargs.get("text") == "cleaned text"
