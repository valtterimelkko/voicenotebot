"""
Test fixtures and configuration for VoiceNote Bot test suite.

This module provides:
- Mocked Telegram API responses
- Mocked Kimi API responses  
- Mocked Whisper service
- Redis test configuration (fakeredis)
- Temp file management
- pytest-asyncio configuration
"""

import os
import sys
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import fakeredis
import pytest
import pytest_asyncio
import respx
from httpx import Response
from redis import Redis

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# Environment setup for tests
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test_token_12345")
os.environ.setdefault("KIMI_API_KEY", "test_kimi_key_12345")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")  # Use DB 15 for tests
os.environ.setdefault("WHISPER_URL", "http://localhost:9000/asr")
os.environ.setdefault("WEBHOOK_SECRET", "test_webhook_secret")
os.environ.setdefault("MAX_FILE_SIZE_MB", "20")
os.environ.setdefault("MAX_RETRIES", "3")
os.environ.setdefault("LOG_LEVEL", "DEBUG")


# =============================================================================
# pytest-asyncio Configuration
# =============================================================================

pytest_plugins = ["pytest_asyncio"]


def pytest_configure(config):
    """Configure pytest-asyncio."""
    config.option.asyncio_mode = "auto"


# =============================================================================
# Redis Test Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def fake_redis() -> Generator[fakeredis.FakeRedis, None, None]:
    """Provide a fake Redis instance for testing."""
    redis_instance = fakeredis.FakeRedis(decode_responses=True)
    yield redis_instance
    redis_instance.flushall()
    redis_instance.close()


@pytest.fixture(scope="function")
def mock_redis_client() -> Generator[Mock, None, None]:
    """Provide a mocked Redis client."""
    mock_client = Mock(spec=Redis)
    mock_client.ping.return_value = True
    mock_client.get.return_value = None
    mock_client.set.return_value = True
    mock_client.delete.return_value = 1
    mock_client.flushall.return_value = True
    yield mock_client


# =============================================================================
# Telegram API Mock Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def mock_telegram_api(respx_mock: respx.MockRouter) -> respx.MockRouter:
    """
    Mock Telegram Bot API endpoints.
    
    Returns a respx MockRouter with common Telegram API endpoints pre-configured.
    """
    base_url = "https://api.telegram.org/bottest_token_12345"
    
    # Send message endpoint
    respx_mock.post(f"{base_url}/sendMessage").mock(
        return_value=Response(
            200,
            json={
                "ok": True,
                "result": {
                    "message_id": 123,
                    "date": 1234567890,
                    "chat": {"id": 12345, "type": "private"},
                    "text": "Message sent",
                }
            }
        )
    )
    
    # Get file endpoint
    respx_mock.post(f"{base_url}/getFile").mock(
        return_value=Response(
            200,
            json={
                "ok": True,
                "result": {
                    "file_id": "voice_file_123",
                    "file_unique_id": "unique_123",
                    "file_path": "voice/file_123.oga",
                    "file_size": 1024,
                }
            }
        )
    )
    
    # Download file endpoint
    respx_mock.get(url__regex=rf"{base_url.replace('/', r'/')}/file/bottest_token_12345/.*").mock(
        return_value=Response(
            200,
            content=b"fake_audio_content",
        )
    )
    
    return respx_mock


@pytest.fixture(scope="function")
def telegram_voice_update() -> dict:
    """Return a sample Telegram voice message update."""
    return {
        "update_id": 123456789,
        "message": {
            "message_id": 42,
            "from": {
                "id": 12345,
                "is_bot": False,
                "first_name": "Test",
                "username": "testuser",
            },
            "chat": {
                "id": 12345,
                "first_name": "Test",
                "username": "testuser",
                "type": "private",
            },
            "date": 1234567890,
            "voice": {
                "duration": 5,
                "mime_type": "audio/ogg",
                "file_id": "voice_file_123",
                "file_unique_id": "unique_123",
                "file_size": 1024,
            },
        }
    }


@pytest.fixture(scope="function")
def telegram_text_update() -> dict:
    """Return a sample Telegram text message update."""
    return {
        "update_id": 123456790,
        "message": {
            "message_id": 43,
            "from": {
                "id": 12345,
                "is_bot": False,
                "first_name": "Test",
                "username": "testuser",
            },
            "chat": {
                "id": 12345,
                "first_name": "Test",
                "username": "testuser",
                "type": "private",
            },
            "date": 1234567891,
            "text": "Hello bot",
        }
    }


@pytest.fixture(scope="function")
def telegram_callback_update() -> dict:
    """Return a sample Telegram callback query update."""
    return {
        "update_id": 123456791,
        "callback_query": {
            "id": "callback_123",
            "from": {
                "id": 12345,
                "is_bot": False,
                "first_name": "Test",
            },
            "message": {
                "message_id": 44,
                "chat": {"id": 12345, "type": "private"},
                "text": "Original message",
            },
            "data": "some_data",
        }
    }


@pytest.fixture(scope="function")
def telegram_error_response() -> dict:
    """Return a sample Telegram API error response."""
    return {
        "ok": False,
        "error_code": 400,
        "description": "Bad Request: message text is empty",
    }


# =============================================================================
# Kimi API Mock Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def mock_kimi_api(respx_mock: respx.MockRouter) -> respx.MockRouter:
    """
    Mock Kimi API endpoints.
    
    Returns a respx MockRouter with Kimi API endpoints pre-configured.
    """
    base_url = "https://api.moonshot.cn"
    
    # Chat completions endpoint
    respx_mock.post(f"{base_url}/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={
                "id": "chat-123",
                "object": "chat.completion",
                "created": 1234567890,
                "model": "kimi-latest",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "This is a formatted transcription of your voice note.",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                },
            }
        )
    )
    
    return respx_mock


@pytest.fixture(scope="function")
def kimi_error_response() -> dict:
    """Return a sample Kimi API error response."""
    return {
        "error": {
            "message": "Invalid API key",
            "type": "authentication_error",
            "code": "invalid_api_key",
        }
    }


# =============================================================================
# Whisper Service Mock Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def mock_whisper_service(respx_mock: respx.MockRouter) -> respx.MockRouter:
    """
    Mock Whisper service endpoint.
    
    Returns a respx MockRouter with Whisper ASR endpoint pre-configured.
    """
    whisper_url = os.getenv("WHISPER_URL", "http://localhost:9000/asr")
    base_url = whisper_url.replace("/asr", "")
    
    # ASR endpoint
    respx_mock.post(f"{whisper_url}").mock(
        return_value=Response(
            200,
            json={
                "text": "This is the transcribed text from the voice note.",
                "language": "en",
                "duration": 5.0,
                "segments": [
                    {
                        "id": 0,
                        "start": 0.0,
                        "end": 5.0,
                        "text": "This is the transcribed text from the voice note.",
                    }
                ],
            }
        )
    )
    
    return respx_mock


@pytest.fixture(scope="function")
def whisper_error_response() -> dict:
    """Return a sample Whisper service error response."""
    return {
        "error": "Failed to process audio",
        "detail": "Audio file is corrupted or in unsupported format",
    }


# =============================================================================
# Temporary File Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def temp_audio_file() -> Generator[Path, None, None]:
    """Create a temporary audio file for testing."""
    with tempfile.NamedTemporaryFile(suffix=".oga", delete=False) as f:
        # Write minimal valid Ogg Opus header
        f.write(b"OggS")  # Ogg container magic number
        f.write(b"\x00" * 26)  # Padding for header
        f.write(b"fake_audio_data")
        temp_path = Path(f.name)
    
    yield temp_path
    
    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


@pytest.fixture(scope="function")
def temp_large_file() -> Generator[Path, None, None]:
    """Create a temporary large file (>20MB) for testing size validation."""
    with tempfile.NamedTemporaryFile(suffix=".oga", delete=False) as f:
        # Write 21MB of data
        f.write(b"0" * (21 * 1024 * 1024))
        temp_path = Path(f.name)
    
    yield temp_path
    
    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


@pytest.fixture(scope="function")
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield Path(tmp_dir)


# =============================================================================
# RQ Queue Mock Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def mock_rq_queue() -> Generator[Mock, None, None]:
    """Mock RQ Queue for testing."""
    with patch("rq.Queue") as mock_queue_class:
        mock_queue = Mock()
        mock_queue.enqueue.return_value = Mock(
            id="test_job_id_123",
            get_status=Mock(return_value="queued"),
        )
        mock_queue_class.return_value = mock_queue
        yield mock_queue


@pytest.fixture(scope="function")
def mock_job() -> Mock:
    """Return a mock RQ Job."""
    job = Mock()
    job.id = "test_job_id_123"
    job.get_status.return_value = "finished"
    job.result = "Transcription completed"
    job.exc_info = None
    job.is_failed = False
    return job


# =============================================================================
# FastAPI Test Client Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def webhook_app(mock_redis_client: Mock) -> Generator:
    """Create FastAPI app for webhook tests with mocked Redis."""
    with patch("webhook.main.get_redis_connection", return_value=mock_redis_client):
        with patch("webhook.main.Redis") as mock_redis_class:
            mock_redis_class.from_url.return_value = mock_redis_client
            
            # Import after patching
            from webhook.main import app
            yield app


@pytest_asyncio.fixture(scope="function")
async def async_webhook_client(webhook_app) -> AsyncGenerator:
    """Create async test client for webhook tests."""
    from httpx import AsyncClient
    
    async with AsyncClient(app=webhook_app, base_url="http://test") as client:
        yield client


# =============================================================================
# Shared Client Mock Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def mock_telegram_client() -> Generator[Mock, None, None]:
    """Mock TelegramClient for testing."""
    with patch("shared.telegram_client.send_message", new_callable=AsyncMock) as mock:
        mock.return_value = {
            "ok": True,
            "result": {
                "message_id": 123,
                "text": "Test message",
            }
        }
        yield mock


@pytest.fixture(scope="function")
def mock_kimi_client() -> Generator[Mock, None, None]:
    """Mock KimiClient for testing."""
    with patch("shared.kimi_client.KimiClient") as mock_class:
        mock_instance = Mock()
        mock_instance.format_transcription = AsyncMock(return_value="Formatted transcription text")
        mock_instance.summarize = AsyncMock(return_value="Summary of the transcription")
        mock_class.return_value = mock_instance
        yield mock_instance


# =============================================================================
# Test Data Fixtures
# =============================================================================

@pytest.fixture(scope="function")
def sample_transcription() -> str:
    """Return a sample raw transcription text."""
    return "This is a test transcription from the Whisper ASR service."


@pytest.fixture(scope="function")
def sample_formatted_text() -> str:
    """Return a sample formatted transcription from Kimi."""
    return """📝 **Transcription**

This is a formatted transcription of your voice note. The AI has organized it into clear paragraphs and fixed any grammar issues.

---
_Processed by VoiceNote Bot_"""


@pytest.fixture(scope="function")
def sample_voice_metadata() -> dict:
    """Return sample voice file metadata."""
    return {
        "file_id": "voice_file_123",
        "file_unique_id": "unique_123",
        "file_path": "voice/file_123.oga",
        "file_size": 1024,
        "duration": 5,
        "mime_type": "audio/ogg",
    }
