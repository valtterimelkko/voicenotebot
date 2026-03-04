"""
VoiceNote Bot Webhook Service

FastAPI application that receives Telegram webhook updates,
validates voice messages, and enqueues transcription jobs to RQ.
"""

import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from redis import Redis
from rq import Queue

# Add parent directory to path for shared imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.logger import get_logger
from shared.telegram_client import TelegramClient

logger = get_logger(__name__)

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = "default"
JOB_FUNCTION = "tasks.process_voice_note"

# Global Telegram client instance (initialized in lifespan)
telegram_client: TelegramClient | None = None


def get_redis_connection() -> Redis:
    """Create and return Redis connection."""
    try:
        return Redis.from_url(REDIS_URL, socket_connect_timeout=5)
    except Exception as e:
        logger.error("Failed to connect to Redis", error=str(e), redis_url=REDIS_URL)
        raise


def get_queue() -> Queue:
    """Create and return RQ queue."""
    redis = get_redis_connection()
    return Queue(name=QUEUE_NAME, connection=redis)


async def send_transcribing_message(chat_id: int) -> None:
    """Send 'Transcribing...' message to user."""
    global telegram_client
    try:
        if telegram_client is None:
            telegram_client = TelegramClient()
        await telegram_client.send_message(chat_id=chat_id, text="🎙️ Transcribing...")
        logger.debug("transcribing_message_sent", chat_id=chat_id)
    except Exception as e:
        logger.warning("failed_to_send_transcribing_message", chat_id=chat_id, error=str(e))
        # Don't raise - this is non-critical


def enqueue_transcription_job(
    file_id: str,
    chat_id: int,
    message_id: int | None = None,
) -> str | None:
    """Enqueue voice transcription job to RQ."""
    try:
        queue = get_queue()
        job = queue.enqueue(
            JOB_FUNCTION,
            file_id=file_id,
            chat_id=chat_id,
            message_id=message_id,
        )
        logger.info(
            "transcription_job_enqueued",
            job_id=job.id,
            file_id=file_id,
            chat_id=chat_id,
        )
        return job.id
    except Exception as e:
        logger.error(
            "failed_to_enqueue_job",
            error=str(e),
            file_id=file_id,
            chat_id=chat_id,
        )
        return None


def is_voice_message(update: dict) -> bool:
    """Check if update contains a voice message."""
    if not isinstance(update, dict):
        return False
    message = update.get("message")
    if not isinstance(message, dict):
        return False
    return "voice" in message


def extract_voice_data(update: dict) -> dict | None:
    """Extract voice message data from update."""
    try:
        message = update.get("message", {})
        voice = message.get("voice", {})
        return {
            "file_id": voice.get("file_id"),
            "chat_id": message.get("chat", {}).get("id"),
            "message_id": message.get("message_id"),
        }
    except Exception as e:
        logger.warning("failed_to_extract_voice_data", error=str(e))
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global telegram_client
    
    logger.info("webhook_service_starting", redis_url=REDIS_URL, queue=QUEUE_NAME)
    
    # Initialize Telegram client
    try:
        telegram_client = TelegramClient()
        logger.info("telegram_client_initialized")
    except Exception as e:
        logger.error("failed_to_initialize_telegram_client", error=str(e))
    
    # Test Redis connection on startup
    try:
        redis = get_redis_connection()
        redis.ping()
        logger.info("redis_connection_verified")
    except Exception as e:
        logger.error("redis_connection_failed", error=str(e))
    
    yield
    
    # Cleanup
    if telegram_client:
        await telegram_client.close()
    logger.info("webhook_service_shutdown")


app = FastAPI(
    title="VoiceNote Bot Webhook",
    description="Telegram webhook handler for voice message transcription",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        redis = get_redis_connection()
        redis.ping()
        redis_status = "connected"
    except Exception as e:
        redis_status = f"error: {str(e)}"
    
    return {
        "status": "healthy",
        "redis": redis_status,
        "queue": QUEUE_NAME,
    }


@app.post("/webhook")
async def webhook_handler(request: Request):
    """
    Handle Telegram webhook updates.
    
    - Accepts Telegram Update JSON
    - Validates it's a voice message
    - Ignores non-voice messages (returns 200 OK silently)
    - Enqueues job to RQ for voice transcription
    - Sends 'Transcribing...' message to user
    - Returns immediately (async processing)
    """
    try:
        # Parse Telegram update
        try:
            update = await request.json()
        except Exception as e:
            logger.warning("failed_to_parse_webhook_json", error=str(e))
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"ok": False, "error": "Invalid JSON"},
            )
        
        update_id = update.get("update_id", "unknown")
        logger.debug("webhook_received", update_id=update_id)
        
        # Check if this is a voice message
        if not is_voice_message(update):
            logger.debug("ignoring_non_voice_message", update_id=update_id)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"ok": True, "ignored": True},
            )
        
        # Extract voice data
        voice_data = extract_voice_data(update)
        if not voice_data or not voice_data.get("file_id"):
            logger.warning("could_not_extract_voice_data", update_id=update_id)
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"ok": True, "ignored": True, "reason": "no_voice_data"},
            )
        
        file_id = voice_data["file_id"]
        chat_id = voice_data["chat_id"]
        message_id = voice_data["message_id"]
        
        logger.info(
            "processing_voice_message",
            file_id=file_id,
            chat_id=chat_id,
            message_id=message_id,
        )
        
        # Enqueue transcription job
        job_id = enqueue_transcription_job(
            file_id=file_id,
            chat_id=chat_id,
            message_id=message_id,
        )
        
        if not job_id:
            logger.error("failed_to_enqueue_job", file_id=file_id)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"ok": False, "error": "Failed to enqueue job"},
            )
        
        # Send "Transcribing..." message asynchronously (don't await, don't block)
        import asyncio
        asyncio.create_task(send_transcribing_message(chat_id))
        
        logger.info(
            "webhook_processed_successfully",
            job_id=job_id,
            file_id=file_id,
            chat_id=chat_id,
        )
        
        # Return immediately - processing is async via RQ
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"ok": True, "job_id": job_id},
        )
        
    except Exception as e:
        logger.exception("unexpected_error_in_webhook_handler", error=str(e))
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"ok": False, "error": "Internal server error"},
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("WEBHOOK_PORT", "8000"))
    host = os.getenv("WEBHOOK_HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
