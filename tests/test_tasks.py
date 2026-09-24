"""
Worker task tests for VoiceNote Bot.

Tests the current pipeline in worker/tasks.py:
    download → Whisper (locked) → OpenAI fallback transcription →
    OpenAI gpt-5-nano cleanup → send result

Covers:
- Success path and result dict shape
- File size validation (metadata and downloaded bytes)
- Whisper failure → OpenAI fallback transcription
- Cleanup failures (token limit, generic) and empty-cleanup fallback
- Temp file cleanup on success and failure
- Error message mapping
- Whisper distributed lock behaviour
- _transcribe_with_whisper error handling
- _run_async in and out of a running event loop
"""

import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import httpx
import pytest
import respx
from httpx import Response

import worker.tasks as worker_tasks


RAW_TRANSCRIPT = "this is the raw transcribed text"
CLEANED_TRANSCRIPT = "This is the raw transcribed text."
WHISPER_URL = worker_tasks.WHISPER_URL


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def lock_redis() -> fakeredis.FakeRedis:
    """Fake Redis in str mode, mirroring worker.tasks' production client
    (redis.from_url(..., decode_responses=True)) used for the Whisper lock."""
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture(scope="function")
def telegram_client_cls() -> MagicMock:
    """Patch worker.tasks.TelegramClient with a fully mocked instance."""
    with patch.object(worker_tasks, "TelegramClient") as mock_cls:
        instance = MagicMock()
        instance.get_file = AsyncMock(return_value={
            "file_id": "voice_file_123",
            "file_path": "voice/file_123.oga",
            "file_size": 1024,
        })
        instance.download_file = AsyncMock(return_value=b"fake_audio_data")
        instance.send_message = AsyncMock(return_value={"ok": True, "result": {"message_id": 999}})
        instance.close = AsyncMock()
        mock_cls.return_value = instance
        yield mock_cls


@pytest.fixture(scope="function")
def cleanup_client_cls() -> MagicMock:
    """Patch worker.tasks.OpenAICleanupClient with a mocked instance."""
    with patch.object(worker_tasks, "OpenAICleanupClient") as mock_cls:
        instance = MagicMock()
        instance.cleanup_transcript = AsyncMock(return_value=CLEANED_TRANSCRIPT)
        instance.close = AsyncMock()
        mock_cls.return_value = instance
        yield mock_cls


@pytest.fixture(scope="function")
def whisper_ok(respx_mock: respx.MockRouter) -> respx.MockRouter:
    """Whisper ASR returns plain-text transcript."""
    respx_mock.post(WHISPER_URL).mock(
        return_value=Response(200, text=RAW_TRANSCRIPT)
    )
    return respx_mock


@pytest.fixture(scope="function")
def whisper_down(respx_mock: respx.MockRouter) -> respx.MockRouter:
    """Whisper ASR returns 500."""
    respx_mock.post(WHISPER_URL).mock(
        return_value=Response(500, text="Internal Server Error")
    )
    return respx_mock


# =============================================================================
# Success Path Tests
# =============================================================================

@pytest.mark.asyncio
class TestSuccessfulProcessing:
    """Tests for the successful processing flow."""

    async def test_successful_processing_flow(
        self,
        respx_mock: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """Full flow returns success dict, sends cleaned text, removes temp file."""
        whisper_ok = respx_mock.post(WHISPER_URL).mock(
            return_value=Response(200, text=RAW_TRANSCRIPT)
        )

        removed_paths = []
        real_remove = os.remove

        def tracking_remove(path, *args, **kwargs):
            removed_paths.append(str(path))
            return real_remove(path, *args, **kwargs)

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks.os, "remove", side_effect=tracking_remove):
                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345, message_id=42,
                )

        assert result == {
            "success": True,
            "provider": "whisper",
            "transcript_length": len(RAW_TRANSCRIPT),
            "cleaned_length": len(CLEANED_TRANSCRIPT),
        }
        assert whisper_ok.called
        telegram_client_cls.return_value.send_message.assert_awaited_once_with(
            chat_id=12345, text=CLEANED_TRANSCRIPT,
        )
        # Temp file was created and then removed by the finally block.
        assert len(removed_paths) == 1
        assert not Path(removed_paths[0]).exists()

    async def test_empty_cleanup_falls_back_to_raw_transcript(
        self,
        whisper_ok: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """If cleanup returns empty, the raw transcript is sent instead."""
        cleanup_client_cls.return_value.cleanup_transcript = AsyncMock(return_value="")

        with patch.object(worker_tasks, "redis_client", lock_redis):
            result = worker_tasks.process_voice_note(
                file_id="voice_file_123", chat_id=12345,
            )

        assert result["success"] is True
        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == RAW_TRANSCRIPT

    async def test_missing_file_path_returns_failure(
        self,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
    ):
        """get_file without file_path fails fast with a general error message."""
        telegram_client_cls.return_value.get_file = AsyncMock(return_value={})

        result = worker_tasks.process_voice_note(
            file_id="voice_file_123", chat_id=12345,
        )

        assert result == {"success": False, "error": "failed_to_get_file_path"}
        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_GENERAL


# =============================================================================
# File Size Validation Tests
# =============================================================================

@pytest.mark.asyncio
class TestFileSizeValidation:
    """Tests for file size validation (max 20MB)."""

    async def test_metadata_file_too_large_rejected_before_download(
        self,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        respx_mock: respx.MockRouter,
    ):
        """A file too large per Telegram metadata is rejected without download."""
        telegram_client_cls.return_value.get_file = AsyncMock(return_value={
            "file_path": "voice/big.oga",
            "file_size": worker_tasks.MAX_FILE_SIZE_BYTES + 1,
        })
        download_route = respx_mock.post(url__startswith="https://api.telegram.org").mock(
            return_value=Response(200, json={"ok": True, "result": {}})
        )

        result = worker_tasks.process_voice_note(
            file_id="voice_file_123", chat_id=12345,
        )

        assert result == {"success": False, "error": "file_too_large"}
        telegram_client_cls.return_value.download_file.assert_not_awaited()
        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_FILE_TOO_LARGE
        assert not download_route.called

    async def test_downloaded_file_too_large_rejected_before_transcription(
        self,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
        respx_mock: respx.MockRouter,
    ):
        """Content larger than the limit is rejected after download, before Whisper."""
        telegram_client_cls.return_value.download_file = AsyncMock(
            return_value=b"0" * (worker_tasks.MAX_FILE_SIZE_BYTES + 1)
        )
        whisper_route = respx_mock.post(WHISPER_URL).mock(
            return_value=Response(200, text=RAW_TRANSCRIPT)
        )

        with patch.object(worker_tasks, "redis_client", lock_redis):
            result = worker_tasks.process_voice_note(
                file_id="voice_file_123", chat_id=12345,
            )

        assert result == {"success": False, "error": "file_too_large"}
        assert not whisper_route.called
        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_FILE_TOO_LARGE


# =============================================================================
# Transcription Fallback Tests
# =============================================================================

@pytest.mark.asyncio
class TestTranscriptionFallback:
    """Tests for Whisper-primary, OpenAI-fallback transcription."""

    async def test_whisper_failure_falls_back_to_openai(
        self,
        whisper_down: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """When Whisper fails, the OpenAI transcription client is used."""
        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks, "OpenAITranscriptionClient") as mock_cls:
                instance = MagicMock()
                instance.transcribe = MagicMock(return_value=RAW_TRANSCRIPT)
                instance.close = MagicMock()
                mock_cls.return_value = instance

                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        assert result["success"] is True
        assert result["provider"] == "openai"
        mock_cls.return_value.transcribe.assert_called_once()

    async def test_no_openai_fallback_without_api_key(
        self,
        whisper_down: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """Without OPENAI_API_KEY, failed Whisper leads to transcription_empty."""
        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks, "OPENAI_API_KEY", ""):
                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        assert result == {"success": False, "error": "transcription_empty"}
        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_WHISPER_FAILED

    async def test_both_providers_failing_returns_transcription_empty(
        self,
        whisper_down: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """When both Whisper and OpenAI fail, the user gets the whisper error."""
        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks, "OpenAITranscriptionClient") as mock_cls:
                mock_cls.return_value.transcribe.side_effect = Exception("OpenAI down")

                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        assert result == {"success": False, "error": "transcription_empty"}

    async def test_empty_whisper_text_falls_back_to_openai(
        self,
        respx_mock: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """Whisper returning empty text counts as no transcript → OpenAI fallback."""
        respx_mock.post(WHISPER_URL).mock(return_value=Response(200, text="   "))

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks, "OpenAITranscriptionClient") as mock_cls:
                mock_cls.return_value.transcribe = MagicMock(return_value=RAW_TRANSCRIPT)

                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        assert result["success"] is True
        assert result["provider"] == "openai"


# =============================================================================
# Cleanup Failure Tests
# =============================================================================

@pytest.mark.asyncio
class TestCleanupFailures:
    """Tests for OpenAI cleanup failure handling."""

    async def test_cleanup_token_limit_sends_specific_error_and_reraises(
        self,
        whisper_ok: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """A token-limit cleanup error sends the token-limit message and re-raises."""
        from shared import OpenAICleanupError

        cleanup_client_cls.return_value.cleanup_transcript = AsyncMock(
            side_effect=OpenAICleanupError("token_limit_exceeded", error_code=413)
        )

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with pytest.raises(OpenAICleanupError):
                worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_CLEANUP_TOKEN_LIMIT

    async def test_cleanup_generic_error_sends_general_error_and_reraises(
        self,
        whisper_ok: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """A generic cleanup error sends the general message and re-raises."""
        from shared import OpenAICleanupError

        cleanup_client_cls.return_value.cleanup_transcript = AsyncMock(
            side_effect=OpenAICleanupError("boom", error_code=500)
        )

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with pytest.raises(OpenAICleanupError):
                worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_GENERAL

    async def test_unexpected_error_sends_general_error_and_reraises(
        self,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
    ):
        """An unexpected exception sends an error message and re-raises for RQ retry."""
        telegram_client_cls.return_value.get_file = AsyncMock(
            side_effect=RuntimeError("network exploded")
        )

        with pytest.raises(RuntimeError):
            worker_tasks.process_voice_note(
                file_id="voice_file_123", chat_id=12345,
            )

        _, kwargs = telegram_client_cls.return_value.send_message.call_args
        assert kwargs["text"] == worker_tasks.ERROR_GENERAL


# =============================================================================
# Temp File Cleanup Tests
# =============================================================================

@pytest.mark.asyncio
class TestTempFileCleanup:
    """Tests for temporary file cleanup guarantees."""

    async def test_cleanup_failure_does_not_mask_success(
        self,
        whisper_ok: respx.MockRouter,
        telegram_client_cls: MagicMock,
        cleanup_client_cls: MagicMock,
        lock_redis: fakeredis.FakeRedis,
    ):
        """A temp-file removal failure is logged but does not fail the job."""
        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks.os, "remove", side_effect=PermissionError("nope")):
                result = worker_tasks.process_voice_note(
                    file_id="voice_file_123", chat_id=12345,
                )

        assert result["success"] is True


# =============================================================================
# Error Message Mapping Tests
# =============================================================================

class TestErrorMessageMapping:
    """Tests for _get_error_message_for_exception."""

    def test_token_limit_string_maps_to_token_limit_message(self):
        assert worker_tasks._get_error_message_for_exception(
            Exception("token_limit_exceeded for input")
        ) == worker_tasks.ERROR_CLEANUP_TOKEN_LIMIT

    def test_cleanup_error_413_maps_to_token_limit_message(self):
        from shared import OpenAICleanupError

        assert worker_tasks._get_error_message_for_exception(
            OpenAICleanupError("too long", error_code=413)
        ) == worker_tasks.ERROR_CLEANUP_TOKEN_LIMIT

    def test_whisper_error_maps_to_whisper_message(self):
        assert worker_tasks._get_error_message_for_exception(
            Exception("Whisper transcription failed: HTTP 500")
        ) == worker_tasks.ERROR_WHISPER_FAILED

    def test_size_error_maps_to_file_too_large_message(self):
        assert worker_tasks._get_error_message_for_exception(
            Exception("File too large to process")
        ) == worker_tasks.ERROR_FILE_TOO_LARGE

    def test_unknown_error_maps_to_general_message(self):
        assert worker_tasks._get_error_message_for_exception(
            Exception("mysterious failure")
        ) == worker_tasks.ERROR_GENERAL


# =============================================================================
# Whisper Lock Tests
# =============================================================================

class TestWhisperLock:
    """Tests for the distributed Whisper lock."""

    def test_acquire_and_release(self, lock_redis: fakeredis.FakeRedis):
        with patch.object(worker_tasks, "redis_client", lock_redis):
            lock = worker_tasks.WhisperLock(timeout=60)

            assert lock.acquire() is True
            assert lock.acquired is True
            assert lock_redis.get(worker_tasks.WhisperLock.LOCK_KEY) == lock.lock_value

            lock.release()
            assert lock.acquired is False
            assert lock_redis.get(worker_tasks.WhisperLock.LOCK_KEY) is None

    def test_release_only_when_owner(self, lock_redis: fakeredis.FakeRedis):
        with patch.object(worker_tasks, "redis_client", lock_redis):
            lock_redis.set(worker_tasks.WhisperLock.LOCK_KEY, "held-by-someone-else")

            lock = worker_tasks.WhisperLock()
            lock.lock_value = "my-value"
            lock.acquired = True
            lock.release()

            # Foreign lock must remain untouched.
            assert lock_redis.get(worker_tasks.WhisperLock.LOCK_KEY) == "held-by-someone-else"

    def test_acquire_fallback_without_redis(self):
        with patch.object(worker_tasks, "redis_client", None):
            lock = worker_tasks.WhisperLock()
            assert lock.acquire() is True

    def test_acquire_returns_false_when_locked(self, lock_redis: fakeredis.FakeRedis):
        with patch.object(worker_tasks, "redis_client", lock_redis):
            lock_redis.set(worker_tasks.WhisperLock.LOCK_KEY, "held")

            lock = worker_tasks.WhisperLock()
            assert lock.acquire() is False

    def test_retry_gives_up_after_max_wait(self, lock_redis: fakeredis.FakeRedis):
        """When the lock can't be acquired in time, an unlocked lock is returned
        as a fallback so processing can proceed anyway."""
        lock_redis.set(worker_tasks.WhisperLock.LOCK_KEY, "held")

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with patch.object(worker_tasks.time, "sleep") as mock_sleep:
                lock = worker_tasks._acquire_whisper_lock_with_retry(max_wait=0)

        assert lock.acquired is False
        mock_sleep.assert_not_called()


# =============================================================================
# Whisper HTTP Client Tests
# =============================================================================

class TestTranscribeWithWhisper:
    """Tests for the _transcribe_with_whisper HTTP helper."""

    def test_success_returns_text(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
        lock_redis: fakeredis.FakeRedis,
    ):
        respx_mock.post(WHISPER_URL).mock(return_value=Response(200, text=RAW_TRANSCRIPT))

        with patch.object(worker_tasks, "redis_client", lock_redis):
            result = worker_tasks._transcribe_with_whisper(str(temp_audio_file))

        assert result == RAW_TRANSCRIPT

    def test_http_error_raises(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
        lock_redis: fakeredis.FakeRedis,
    ):
        respx_mock.post(WHISPER_URL).mock(return_value=Response(500, text="error"))

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with pytest.raises(Exception, match="HTTP 500"):
                worker_tasks._transcribe_with_whisper(str(temp_audio_file))

    def test_timeout_raises(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
        lock_redis: fakeredis.FakeRedis,
    ):
        respx_mock.post(WHISPER_URL).mock(
            side_effect=httpx.ReadTimeout("timed out")
        )

        with patch.object(worker_tasks, "redis_client", lock_redis):
            with pytest.raises(Exception, match="timed out"):
                worker_tasks._transcribe_with_whisper(str(temp_audio_file))

    def test_empty_text_returns_none(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
        lock_redis: fakeredis.FakeRedis,
    ):
        respx_mock.post(WHISPER_URL).mock(return_value=Response(200, text="   "))

        with patch.object(worker_tasks, "redis_client", lock_redis):
            result = worker_tasks._transcribe_with_whisper(str(temp_audio_file))

        assert result is None


# =============================================================================
# _run_async Tests
# =============================================================================

class TestRunAsync:
    """Tests for the sync/async bridge."""

    def test_run_async_without_running_loop(self):
        async def coro():
            return "done"

        assert worker_tasks._run_async(coro()) == "done"

    @pytest.mark.asyncio
    async def test_run_async_with_running_loop(self):
        """Inside a running loop, _run_async bridges via a worker thread."""

        async def coro():
            await asyncio.sleep(0)
            return 42

        assert worker_tasks._run_async(coro()) == 42
