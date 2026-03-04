"""
Webhook service tests for VoiceNote Bot.

Tests the FastAPI webhook endpoints including:
- Voice message webhook creates job
- Non-voice message is ignored
- Invalid JSON returns error
- Health check endpoint
- RQ queue enqueue verification
"""

import json
from http import HTTPStatus
from unittest.mock import AsyncMock, Mock, patch

import pytest
import respx
from httpx import AsyncClient, Response


# =============================================================================
# Health Check Tests
# =============================================================================

@pytest.mark.asyncio
class TestHealthCheck:
    """Tests for the /health endpoint."""
    
    async def test_health_check_success(self, async_webhook_client: AsyncClient, mock_redis_client: Mock):
        """Test health check returns healthy when Redis is connected."""
        mock_redis_client.ping.return_value = True
        
        response = await async_webhook_client.get("/health")
        
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert data["status"] == "healthy"
        assert data["redis"] == "connected"
        assert data["queue"] == "default"
    
    async def test_health_check_redis_error(self, async_webhook_client: AsyncClient, mock_redis_client: Mock):
        """Test health check returns error status when Redis fails."""
        mock_redis_client.ping.side_effect = Exception("Connection refused")
        
        response = await async_webhook_client.get("/health")
        
        assert response.status_code == HTTPStatus.OK
        data = response.json()
        assert data["status"] == "healthy"  # Endpoint still returns 200
        assert "error" in data["redis"]


# =============================================================================
# Webhook Handler Tests
# =============================================================================

@pytest.mark.asyncio
class TestWebhookHandler:
    """Tests for the /webhook endpoint."""
    
    async def test_valid_voice_message_creates_job(
        self,
        async_webhook_client: AsyncClient,
        telegram_voice_update: dict,
        mock_telegram_client: Mock,
    ):
        """Test that valid voice message webhook enqueues a transcription job."""
        with patch("webhook.main.enqueue_transcription_job", return_value="test_job_id_123") as mock_enqueue:
            response = await async_webhook_client.post(
                "/webhook",
                json=telegram_voice_update,
            )
            
            assert response.status_code == HTTPStatus.OK
            data = response.json()
            assert data["ok"] is True
            assert data["job_id"] == "test_job_id_123"
            
            # Verify job was enqueued with correct parameters
            mock_enqueue.assert_called_once_with(
                file_id="voice_file_123",
                chat_id=12345,
                message_id=42,
            )
    
    async def test_valid_voice_message_sends_transcribing_notification(
        self,
        async_webhook_client: AsyncClient,
        telegram_voice_update: dict,
    ):
        """Test that voice message triggers 'Transcribing...' notification."""
        with patch("webhook.main.enqueue_transcription_job", return_value="test_job_id_123"):
            with patch("webhook.main.send_transcribing_message", new_callable=AsyncMock) as mock_send:
                response = await async_webhook_client.post(
                    "/webhook",
                    json=telegram_voice_update,
                )
                
                assert response.status_code == HTTPStatus.OK
                # Note: send_transcribing_message is called with create_task
                # so we need to let the event loop process it
                mock_send.assert_called_once_with(chat_id=12345)
    
    async def test_text_message_is_ignored(
        self,
        async_webhook_client: AsyncClient,
        telegram_text_update: dict,
    ):
        """Test that text messages are ignored with 200 OK."""
        with patch("webhook.main.enqueue_transcription_job") as mock_enqueue:
            response = await async_webhook_client.post(
                "/webhook",
                json=telegram_text_update,
            )
            
            assert response.status_code == HTTPStatus.OK
            data = response.json()
            assert data["ok"] is True
            assert data["ignored"] is True
            
            # Verify no job was enqueued
            mock_enqueue.assert_not_called()
    
    async def test_callback_query_is_ignored(
        self,
        async_webhook_client: AsyncClient,
        telegram_callback_update: dict,
    ):
        """Test that callback queries are ignored with 200 OK."""
        with patch("webhook.main.enqueue_transcription_job") as mock_enqueue:
            response = await async_webhook_client.post(
                "/webhook",
                json=telegram_callback_update,
            )
            
            assert response.status_code == HTTPStatus.OK
            data = response.json()
            assert data["ok"] is True
            assert data["ignored"] is True
            mock_enqueue.assert_not_called()
    
    async def test_invalid_json_returns_error(self, async_webhook_client: AsyncClient):
        """Test that invalid JSON returns 400 Bad Request."""
        response = await async_webhook_client.post(
            "/webhook",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == HTTPStatus.BAD_REQUEST
        data = response.json()
        assert data["ok"] is False
        assert "error" in data
    
    async def test_empty_body_returns_error(self, async_webhook_client: AsyncClient):
        """Test that empty body returns 400 Bad Request."""
        response = await async_webhook_client.post(
            "/webhook",
            content="",
            headers={"Content-Type": "application/json"},
        )
        
        assert response.status_code == HTTPStatus.BAD_REQUEST
        data = response.json()
        assert data["ok"] is False
    
    async def test_voice_message_without_file_id(
        self,
        async_webhook_client: AsyncClient,
    ):
        """Test voice message without file_id is handled gracefully."""
        update = {
            "update_id": 123,
            "message": {
                "message_id": 42,
                "chat": {"id": 12345, "type": "private"},
                "voice": {
                    "duration": 5,
                    "mime_type": "audio/ogg",
                    # Missing file_id
                },
            }
        }
        
        with patch("webhook.main.enqueue_transcription_job") as mock_enqueue:
            response = await async_webhook_client.post("/webhook", json=update)
            
            assert response.status_code == HTTPStatus.OK
            data = response.json()
            assert data["ok"] is True
            assert data["ignored"] is True
            assert data.get("reason") == "no_voice_data"
            mock_enqueue.assert_not_called()
    
    async def test_enqueue_failure_returns_error(
        self,
        async_webhook_client: AsyncClient,
        telegram_voice_update: dict,
    ):
        """Test that enqueue failure returns 500 error."""
        with patch("webhook.main.enqueue_transcription_job", return_value=None) as mock_enqueue:
            response = await async_webhook_client.post(
                "/webhook",
                json=telegram_voice_update,
            )
            
            assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
            data = response.json()
            assert data["ok"] is False
            assert "error" in data
    
    async def test_unexpected_error_returns_500(
        self,
        async_webhook_client: AsyncClient,
        telegram_voice_update: dict,
    ):
        """Test unexpected exceptions return 500 error."""
        with patch("webhook.main.is_voice_message", side_effect=Exception("Unexpected error")):
            response = await async_webhook_client.post(
                "/webhook",
                json=telegram_voice_update,
            )
            
            assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
            data = response.json()
            assert data["ok"] is False
            assert "error" in data


# =============================================================================
# Voice Message Detection Tests
# =============================================================================

class TestVoiceMessageDetection:
    """Tests for the is_voice_message function."""
    
    def test_is_voice_message_true(self, telegram_voice_update: dict):
        """Test is_voice_message returns True for voice messages."""
        from webhook.main import is_voice_message
        
        assert is_voice_message(telegram_voice_update) is True
    
    def test_is_voice_message_false_for_text(self, telegram_text_update: dict):
        """Test is_voice_message returns False for text messages."""
        from webhook.main import is_voice_message
        
        assert is_voice_message(telegram_text_update) is False
    
    def test_is_voice_message_false_for_callback(self, telegram_callback_update: dict):
        """Test is_voice_message returns False for callback queries."""
        from webhook.main import is_voice_message
        
        assert is_voice_message(telegram_callback_update) is False
    
    def test_is_voice_message_with_none(self):
        """Test is_voice_message handles None gracefully."""
        from webhook.main import is_voice_message
        
        assert is_voice_message(None) is False
    
    def test_is_voice_message_with_empty_dict(self):
        """Test is_voice_message handles empty dict gracefully."""
        from webhook.main import is_voice_message
        
        assert is_voice_message({}) is False
    
    def test_is_voice_message_with_no_message_key(self):
        """Test is_voice_message handles missing message key."""
        from webhook.main import is_voice_message
        
        update = {"update_id": 123}
        assert is_voice_message(update) is False


# =============================================================================
# Voice Data Extraction Tests
# =============================================================================

class TestVoiceDataExtraction:
    """Tests for the extract_voice_data function."""
    
    def test_extract_voice_data_success(self, telegram_voice_update: dict):
        """Test extract_voice_data returns correct data."""
        from webhook.main import extract_voice_data
        
        result = extract_voice_data(telegram_voice_update)
        
        assert result is not None
        assert result["file_id"] == "voice_file_123"
        assert result["chat_id"] == 12345
        assert result["message_id"] == 42
    
    def test_extract_voice_data_missing_chat(self):
        """Test extract_voice_data handles missing chat."""
        from webhook.main import extract_voice_data
        
        update = {
            "message": {
                "message_id": 42,
                "voice": {"file_id": "test123"},
            }
        }
        
        result = extract_voice_data(update)
        assert result["chat_id"] is None
        assert result["file_id"] == "test123"
    
    def test_extract_voice_data_empty_update(self):
        """Test extract_voice_data handles empty update."""
        from webhook.main import extract_voice_data
        
        result = extract_voice_data({})
        assert result["chat_id"] is None
        assert result["file_id"] is None
        assert result["message_id"] is None


# =============================================================================
# Job Enqueue Tests
# =============================================================================

class TestJobEnqueue:
    """Tests for the enqueue_transcription_job function."""
    
    def test_enqueue_success(self, mock_redis_client: Mock):
        """Test successful job enqueue."""
        from webhook.main import enqueue_transcription_job
        
        mock_job = Mock()
        mock_job.id = "job_id_123"
        
        with patch("webhook.main.get_queue") as mock_get_queue:
            mock_queue = Mock()
            mock_queue.enqueue.return_value = mock_job
            mock_get_queue.return_value = mock_queue
            
            result = enqueue_transcription_job(
                file_id="file_123",
                chat_id=12345,
                message_id=42,
            )
            
            assert result == "job_id_123"
            mock_queue.enqueue.assert_called_once_with(
                "tasks.process_voice_note",
                file_id="file_123",
                chat_id=12345,
                message_id=42,
            )
    
    def test_enqueue_failure_returns_none(self, mock_redis_client: Mock):
        """Test enqueue failure returns None."""
        from webhook.main import enqueue_transcription_job
        
        with patch("webhook.main.get_queue") as mock_get_queue:
            mock_get_queue.side_effect = Exception("Redis connection failed")
            
            result = enqueue_transcription_job(
                file_id="file_123",
                chat_id=12345,
            )
            
            assert result is None


# =============================================================================
# RQ Queue Integration Tests
# =============================================================================

class TestRQIntegration:
    """Tests for RQ queue setup and connection."""
    
    def test_get_redis_connection(self):
        """Test Redis connection creation."""
        from webhook.main import get_redis_connection
        
        with patch("webhook.main.Redis") as mock_redis_class:
            mock_instance = Mock()
            mock_redis_class.from_url.return_value = mock_instance
            
            result = get_redis_connection()
            
            assert result == mock_instance
            mock_redis_class.from_url.assert_called_once_with("redis://localhost:6379/15")
    
    def test_get_queue(self):
        """Test RQ queue creation."""
        from webhook.main import get_queue
        
        mock_redis = Mock()
        with patch("webhook.main.get_redis_connection", return_value=mock_redis):
            with patch("webhook.main.Queue") as mock_queue_class:
                mock_queue = Mock()
                mock_queue_class.return_value = mock_queue
                
                result = get_queue()
                
                mock_queue_class.assert_called_once_with(
                    name="default",
                    connection=mock_redis,
                )


# =============================================================================
# Telegram Client Mock Tests
# =============================================================================

@pytest.mark.asyncio
class TestTelegramNotification:
    """Tests for Telegram notification sending."""
    
    @respx.mock
    async def test_send_transcribing_message_success(self, mock_telegram_api: respx.MockRouter):
        """Test sending 'Transcribing...' message succeeds."""
        from webhook.main import send_transcribing_message
        
        result = await send_transcribing_message(chat_id=12345)
        
        assert result["ok"] is True
        assert "result" in result
    
    @respx.mock
    async def test_send_transcribing_message_failure_not_raised(self, mock_telegram_api: respx.MockRouter):
        """Test send_transcribing_message doesn't raise on failure."""
        from webhook.main import send_transcribing_message
        
        # Mock a failed response
        mock_telegram_api.post("https://api.telegram.org/bottest_token_12345/sendMessage").mock(
            return_value=Response(500, text="Internal Server Error")
        )
        
        # Should not raise
        result = await send_transcribing_message(chat_id=12345)
        
        # The function catches exceptions, so result may be None
