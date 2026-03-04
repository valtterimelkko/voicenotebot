"""
Worker task tests for VoiceNote Bot.

Tests the process_voice_note task including:
- Success path (download → transcribe → format → send)
- File size validation (>20MB rejected)
- Whisper service failure triggers retry
- Kimi API failure triggers retry
- Telegram send failure handling
- Temp file cleanup
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch, mock_open

import pytest
import respx
from httpx import Response


# =============================================================================
# Fixtures for Task Tests
# =============================================================================

@pytest.fixture(scope="function")
def mock_whisper_client():
    """Mock Whisper client for transcription."""
    with patch("tasks.WhisperClient") as mock_class:
        mock_instance = Mock()
        mock_instance.transcribe = AsyncMock(return_value={
            "text": "This is the transcribed text",
            "language": "en",
            "duration": 5.0,
        })
        mock_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture(scope="function")
def mock_kimi_client():
    """Mock Kimi client for formatting."""
    with patch("tasks.KimiClient") as mock_class:
        mock_instance = Mock()
        mock_instance.format_transcription = AsyncMock(return_value="Formatted text")
        mock_class.return_value = mock_instance
        yield mock_instance


@pytest.fixture(scope="function")
def mock_telegram_async_client():
    """Mock async Telegram client."""
    with patch("tasks.send_message", new_callable=AsyncMock) as mock:
        mock.return_value = {"ok": True, "result": {"message_id": 999}}
        yield mock


@pytest.fixture(scope="function")
def mock_telegram_download():
    """Mock Telegram file download."""
    with patch("tasks.download_voice_file", new_callable=AsyncMock) as mock:
        mock.return_value = b"fake_audio_content"
        yield mock


@pytest.fixture(scope="function")
def mock_temp_file():
    """Mock temp file operations."""
    with patch("tempfile.NamedTemporaryFile") as mock:
        mock_file = Mock()
        mock_file.name = "/tmp/test_voice.oga"
        mock.return_value.__enter__ = Mock(return_value=mock_file)
        mock.return_value.__exit__ = Mock(return_value=False)
        yield mock


# =============================================================================
# Success Path Tests
# =============================================================================

@pytest.mark.asyncio
class TestProcessVoiceNoteSuccess:
    """Tests for successful voice note processing."""
    
    async def test_successful_processing_flow(
        self,
        respx_mock: respx.MockRouter,
        mock_telegram_download: Mock,
        mock_telegram_async_client: Mock,
        temp_dir: Path,
    ):
        """Test complete successful processing flow."""
        # Mock Whisper service
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(
            return_value=Response(
                200,
                json={
                    "text": "This is the transcribed text from Whisper",
                    "language": "en",
                    "duration": 5.0,
                }
            )
        )
        
        # Mock Kimi API
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            return_value=Response(
                200,
                json={
                    "choices": [{"message": {"content": "Formatted transcription"}}]
                }
            )
        )
        
        with patch("tasks.TEMP_DIR", str(temp_dir)):
            with patch("tasks.send_message", mock_telegram_async_client):
                from tasks import process_voice_note
                
                result = await process_voice_note(
                    file_id="voice_file_123",
                    chat_id=12345,
                    message_id=42,
                )
                
                assert result is True
                mock_telegram_async_client.assert_called()
    
    async def test_file_download_success(
        self,
        respx_mock: respx.MockRouter,
        temp_dir: Path,
    ):
        """Test voice file is downloaded successfully."""
        # Mock getFile endpoint
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/getFile").mock(
            return_value=Response(
                200,
                json={
                    "ok": True,
                    "result": {
                        "file_id": "voice_file_123",
                        "file_path": "voice/file_123.oga",
                        "file_size": 1024,
                    }
                }
            )
        )
        
        # Mock file download
        respx_mock.get(f"{base_url}/file/bottest_token_12345/voice/file_123.oga").mock(
            return_value=Response(200, content=b"fake_audio_data")
        )
        
        with patch("tasks.TEMP_DIR", str(temp_dir)):
            from tasks import download_voice_file
            
            content = await download_voice_file("voice_file_123")
            assert content == b"fake_audio_data"
    
    async def test_whisper_transcription_success(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
    ):
        """Test Whisper transcription succeeds."""
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(
            return_value=Response(
                200,
                json={
                    "text": "Transcribed text from Whisper",
                    "language": "en",
                    "duration": 5.0,
                }
            )
        )
        
        from tasks import transcribe_with_whisper
        
        result = await transcribe_with_whisper(temp_audio_file)
        
        assert result["text"] == "Transcribed text from Whisper"
        assert result["language"] == "en"
    
    async def test_kimi_formatting_success(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Kimi API formatting succeeds."""
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            return_value=Response(
                200,
                json={
                    "choices": [{
                        "message": {"content": "Formatted transcription with proper punctuation."}
                    }]
                }
            )
        )
        
        from tasks import format_with_kimi
        
        result = await format_with_kimi("raw transcription text")
        
        assert result == "Formatted transcription with proper punctuation."


# =============================================================================
# File Size Validation Tests
# =============================================================================

@pytest.mark.asyncio
class TestFileSizeValidation:
    """Tests for file size validation (>20MB rejected)."""
    
    async def test_large_file_rejected(
        self,
        temp_large_file: Path,
        mock_telegram_async_client: Mock,
    ):
        """Test files >20MB are rejected."""
        from tasks import validate_file_size, MAX_FILE_SIZE_BYTES
        
        # File is 21MB, which exceeds 20MB limit
        assert temp_large_file.stat().st_size > MAX_FILE_SIZE_BYTES
        
        is_valid = validate_file_size(temp_large_file.stat().st_size)
        assert is_valid is False
    
    async def test_valid_file_size_accepted(
        self,
        temp_audio_file: Path,
    ):
        """Test files under 20MB are accepted."""
        from tasks import validate_file_size, MAX_FILE_SIZE_BYTES
        
        # File is small
        assert temp_audio_file.stat().st_size < MAX_FILE_SIZE_BYTES
        
        is_valid = validate_file_size(temp_audio_file.stat().st_size)
        assert is_valid is True
    
    async def test_large_file_sends_error_message(
        self,
        respx_mock: respx.MockRouter,
        temp_large_file: Path,
        mock_telegram_async_client: Mock,
    ):
        """Test that large file sends error message to user."""
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )
        
        with patch("tasks.send_message", mock_telegram_async_client):
            from tasks import handle_oversized_file
            
            await handle_oversized_file(chat_id=12345)
            
            mock_telegram_async_client.assert_called_once()
            call_args = mock_telegram_async_client.call_args
            assert "20MB" in call_args.kwargs.get("text", "")


# =============================================================================
# Whisper Service Failure Tests
# =============================================================================

@pytest.mark.asyncio
class TestWhisperFailures:
    """Tests for Whisper service failure handling."""
    
    async def test_whisper_service_500_error(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
    ):
        """Test Whisper 500 error triggers retry exception."""
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(
            return_value=Response(500, text="Internal Server Error")
        )
        
        from tasks import transcribe_with_whisper, TranscriptionError
        
        with pytest.raises(TranscriptionError) as exc_info:
            await transcribe_with_whisper(temp_audio_file)
        
        assert "retry" in str(exc_info.value).lower() or "whisper" in str(exc_info.value).lower()
    
    async def test_whisper_service_timeout(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
    ):
        """Test Whisper timeout triggers retry."""
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(side_effect=Exception("Connection timeout"))
        
        from tasks import transcribe_with_whisper, TranscriptionError
        
        with pytest.raises(TranscriptionError):
            await transcribe_with_whisper(temp_audio_file)
    
    async def test_whisper_invalid_response(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
    ):
        """Test Whisper invalid JSON response triggers error."""
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(
            return_value=Response(200, text="not valid json")
        )
        
        from tasks import transcribe_with_whisper, TranscriptionError
        
        with pytest.raises(TranscriptionError):
            await transcribe_with_whisper(temp_audio_file)
    
    async def test_whisper_empty_response(
        self,
        respx_mock: respx.MockRouter,
        temp_audio_file: Path,
    ):
        """Test Whisper empty text response."""
        whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
        respx_mock.post(whisper_url).mock(
            return_value=Response(200, json={"text": "", "language": "en"})
        )
        
        from tasks import transcribe_with_whisper
        
        result = await transcribe_with_whisper(temp_audio_file)
        assert result["text"] == ""


# =============================================================================
# Kimi API Failure Tests
# =============================================================================

@pytest.mark.asyncio
class TestKimiFailures:
    """Tests for Kimi API failure handling."""
    
    async def test_kimi_api_401_error(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Kimi 401 error triggers retry."""
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            return_value=Response(
                401,
                json={"error": {"message": "Invalid API key", "type": "authentication_error"}}
            )
        )
        
        from tasks import format_with_kimi, FormattingError
        
        with pytest.raises(FormattingError):
            await format_with_kimi("raw text")
    
    async def test_kimi_api_429_rate_limit(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Kimi rate limit triggers retry."""
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            return_value=Response(
                429,
                json={"error": {"message": "Rate limit exceeded", "type": "rate_limit_error"}}
            )
        )
        
        from tasks import format_with_kimi, FormattingError
        
        with pytest.raises(FormattingError) as exc_info:
            await format_with_kimi("raw text")
        
        assert "rate" in str(exc_info.value).lower() or "retry" in str(exc_info.value).lower()
    
    async def test_kimi_api_500_error(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Kimi 500 error triggers retry."""
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            return_value=Response(500, text="Internal Server Error")
        )
        
        from tasks import format_with_kimi, FormattingError
        
        with pytest.raises(FormattingError):
            await format_with_kimi("raw text")
    
    async def test_kimi_timeout(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Kimi timeout triggers retry."""
        respx_mock.post("https://api.moonshot.cn/v1/chat/completions").mock(
            side_effect=Exception("Request timeout")
        )
        
        from tasks import format_with_kimi, FormattingError
        
        with pytest.raises(FormattingError):
            await format_with_kimi("raw text")


# =============================================================================
# Telegram Send Failure Tests
# =============================================================================

@pytest.mark.asyncio
class TestTelegramSendFailures:
    """Tests for Telegram send failure handling."""
    
    async def test_telegram_send_403_forbidden(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Telegram 403 error (bot blocked by user)."""
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/sendMessage").mock(
            return_value=Response(
                403,
                json={"ok": False, "description": "Forbidden: bot was blocked by the user"}
            )
        )
        
        from tasks import send_transcription_result
        
        # Should not raise, but log the error
        result = await send_transcription_result(chat_id=12345, text="Test")
        # Function handles gracefully
    
    async def test_telegram_send_400_bad_request(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Telegram 400 error (message too long, etc)."""
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/sendMessage").mock(
            return_value=Response(
                400,
                json={"ok": False, "description": "Bad Request: message is too long"}
            )
        )
        
        from tasks import send_transcription_result
        
        result = await send_transcription_result(chat_id=12345, text="x" * 5000)
    
    async def test_telegram_send_timeout(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test Telegram send timeout."""
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/sendMessage").mock(
            side_effect=Exception("Connection timeout")
        )
        
        from tasks import send_transcription_result
        
        # Should handle gracefully
        result = await send_transcription_result(chat_id=12345, text="Test")
    
    async def test_long_message_splitting(
        self,
        respx_mock: respx.MockRouter,
    ):
        """Test long messages are split correctly."""
        base_url = "https://api.telegram.org/bottest_token_12345"
        respx_mock.post(f"{base_url}/sendMessage").mock(
            return_value=Response(200, json={"ok": True})
        )
        
        from tasks import send_transcription_result, MAX_MESSAGE_LENGTH
        
        long_text = "x" * (MAX_MESSAGE_LENGTH + 100)
        
        with patch("tasks.send_message", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}
            await send_transcription_result(chat_id=12345, text=long_text)
            
            # Should be called twice due to splitting
            assert mock_send.call_count == 2


# =============================================================================
# Temp File Cleanup Tests
# =============================================================================

@pytest.mark.asyncio
class TestTempFileCleanup:
    """Tests for temporary file cleanup."""
    
    async def test_temp_file_cleaned_up_on_success(
        self,
        temp_dir: Path,
    ):
        """Test temp files are cleaned up after successful processing."""
        temp_file = temp_dir / "test_voice.oga"
        temp_file.write_text("fake content")
        
        from tasks import cleanup_temp_file
        
        await cleanup_temp_file(temp_file)
        
        assert not temp_file.exists()
    
    async def test_temp_file_cleaned_up_on_failure(
        self,
        temp_dir: Path,
    ):
        """Test temp files are cleaned up even on processing failure."""
        temp_file = temp_dir / "test_voice.oga"
        temp_file.write_text("fake content")
        
        from tasks import cleanup_temp_file
        
        with patch("tasks.logger") as mock_logger:
            await cleanup_temp_file(temp_file)
            
        assert not temp_file.exists()
    
    async def test_cleanup_nonexistent_file_does_not_raise(
        self,
        temp_dir: Path,
    ):
        """Test cleanup of non-existent file doesn't raise error."""
        nonexistent_file = temp_dir / "does_not_exist.oga"
        
        from tasks import cleanup_temp_file
        
        # Should not raise
        await cleanup_temp_file(nonexistent_file)
    
    async def test_cleanup_handles_permission_error(
        self,
        temp_dir: Path,
    ):
        """Test cleanup handles permission errors gracefully."""
        temp_file = temp_dir / "test_voice.oga"
        temp_file.write_text("fake content")
        
        from tasks import cleanup_temp_file
        
        with patch.object(temp_file, "unlink", side_effect=PermissionError("Access denied")):
            with patch("tasks.logger") as mock_logger:
                # Should not raise, just log warning
                await cleanup_temp_file(temp_file)


# =============================================================================
# Retry Logic Tests
# =============================================================================

class TestRetryLogic:
    """Tests for retry logic with exponential backoff."""
    
    def test_retry_config_values(self):
        """Test retry configuration is loaded correctly."""
        from tasks import MAX_RETRIES, RETRY_DELAY_SECONDS
        
        assert MAX_RETRIES == 3
        assert isinstance(RETRY_DELAY_SECONDS, (list, tuple))
        assert len(RETRY_DELAY_SECONDS) == 3
    
    def test_retry_delay_calculation(self):
        """Test retry delay calculation."""
        from tasks import get_retry_delay
        
        assert get_retry_delay(0) == 60  # First retry
        assert get_retry_delay(1) == 300  # Second retry
        assert get_retry_delay(2) == 600  # Third retry
        assert get_retry_delay(3) == 600  # Beyond configured delays, use last


# =============================================================================
# Integration Points Tests
# =============================================================================

@pytest.mark.asyncio
class TestIntegrationPoints:
    """Tests for integration between components."""
    
    async def test_process_voice_note_calls_all_steps(
        self,
        temp_dir: Path,
    ):
        """Test process_voice_note calls all processing steps."""
        with patch("tasks.download_voice_file", new_callable=AsyncMock) as mock_download:
            with patch("tasks.transcribe_with_whisper", new_callable=AsyncMock) as mock_transcribe:
                with patch("tasks.format_with_kimi", new_callable=AsyncMock) as mock_format:
                    with patch("tasks.send_transcription_result", new_callable=AsyncMock) as mock_send:
                        with patch("tasks.cleanup_temp_file", new_callable=AsyncMock) as mock_cleanup:
                            mock_download.return_value = b"audio_data"
                            mock_transcribe.return_value = {"text": "raw text"}
                            mock_format.return_value = "formatted text"
                            mock_send.return_value = True
                            
                            with patch("tasks.TEMP_DIR", str(temp_dir)):
                                from tasks import process_voice_note
                                
                                await process_voice_note("file_id", 12345, 42)
                                
                                mock_download.assert_called_once()
                                mock_transcribe.assert_called_once()
                                mock_format.assert_called_once()
                                mock_send.assert_called_once()
                                mock_cleanup.assert_called_once()
    
    async def test_error_in_download_skips_processing(
        self,
        temp_dir: Path,
    ):
        """Test that download error skips transcription and formatting."""
        with patch("tasks.download_voice_file", new_callable=AsyncMock) as mock_download:
            with patch("tasks.transcribe_with_whisper", new_callable=AsyncMock) as mock_transcribe:
                with patch("tasks.send_error_message", new_callable=AsyncMock) as mock_error:
                    mock_download.side_effect = Exception("Download failed")
                    
                    with patch("tasks.TEMP_DIR", str(temp_dir)):
                        from tasks import process_voice_note
                        
                        await process_voice_note("file_id", 12345, 42)
                        
                        mock_download.assert_called_once()
                        mock_transcribe.assert_not_called()
                        mock_error.assert_called_once()
