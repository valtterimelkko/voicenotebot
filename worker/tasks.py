"""
VoiceNote Bot Worker Tasks

RQ worker tasks for processing voice note transcription:
download → whisper → kimi → send result
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

import httpx
import structlog

# Add parent directory to path for shared imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared import get_logger, TelegramClient, KimiClient, KimiError

# Configure logging
logger = get_logger(__name__)

# Environment configuration
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
WHISPER_URL = os.getenv("WHISPER_URL", "http://whisper:9000/asr")
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "20"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Error messages
ERROR_FILE_TOO_LARGE = (
    "❌ Voice note too large (max 20MB). Please send a shorter message."
)
ERROR_WHISPER_FAILED = (
    "❌ Transcription failed. The audio may be corrupted or too long. Please try again."
)
ERROR_KIMI_TOKEN_LIMIT = (
    "❌ Voice note too long (max ~5 minutes). Please try a shorter voice note."
)
ERROR_GENERAL = "❌ Transcription failed. Please try again."
ERROR_FINAL_RETRY = (
    "❌ Transcription failed after multiple attempts. "
    "Please try again or send a shorter voice note."
)


def _run_async(coro):
    """Run an async coroutine in a sync context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If there's already a running loop, use run_coroutine_threadsafe
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, coro)
                return future.result()
        else:
            return loop.run_until_complete(coro)
    except RuntimeError:
        # No event loop running, create a new one
        return asyncio.run(coro)


def process_voice_note(file_id: str, chat_id: int, message_id: int | None = None) -> dict:
    """
    Process a voice note: download → transcribe → cleanup → send result.
    
    This is the main RQ task that handles the entire transcription pipeline.
    
    Args:
        file_id: Telegram file ID for the voice note
        chat_id: Telegram chat ID to send the result to
        message_id: Optional original message ID for context
        
    Returns:
        Dictionary with transcription result or error info
        
    Raises:
        Exception: Re-raises exceptions for RQ retry mechanism
    """
    logger.info(
        "Starting voice note transcription job",
        file_id=file_id,
        chat_id=chat_id,
        message_id=message_id,
    )
    
    temp_file_path = None
    telegram_client = None
    kimi_client = None
    
    try:
        # Initialize clients
        telegram_client = TelegramClient(token=TELEGRAM_BOT_TOKEN)
        kimi_client = KimiClient()
        
        # Step 1: Get file info from Telegram
        logger.debug("Getting file info from Telegram", file_id=file_id)
        file_info = _run_async(telegram_client.get_file(file_id))
        file_path = file_info.get("file_path")
        
        if not file_path:
            logger.error("Failed to get file path", file_id=file_id)
            _run_async(telegram_client.send_message(chat_id=chat_id, text=ERROR_GENERAL))
            return {"success": False, "error": "failed_to_get_file_path"}
        
        # Check file size from Telegram metadata if available
        file_size = file_info.get("file_size", 0)
        if file_size and file_size > MAX_FILE_SIZE_BYTES:
            logger.warning(
                "File too large (from metadata)",
                file_size_bytes=file_size,
                max_size_bytes=MAX_FILE_SIZE_BYTES,
            )
            _run_async(telegram_client.send_message(chat_id=chat_id, text=ERROR_FILE_TOO_LARGE))
            return {"success": False, "error": "file_too_large"}
        
        # Step 2: Download voice file
        logger.debug("Downloading voice file", file_path=file_path)
        file_bytes = _run_async(telegram_client.download_file(file_path))
        
        # Step 3: Save to temp file and check size
        suffix = Path(file_path).suffix or ".oga"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_file_path = temp_file.name
        
        file_size = os.path.getsize(temp_file_path)
        logger.debug("Voice file saved", file_size_bytes=file_size)
        
        if file_size > MAX_FILE_SIZE_BYTES:
            logger.warning(
                "File too large",
                file_size_bytes=file_size,
                max_size_bytes=MAX_FILE_SIZE_BYTES,
            )
            _run_async(telegram_client.send_message(chat_id=chat_id, text=ERROR_FILE_TOO_LARGE))
            return {"success": False, "error": "file_too_large"}
        
        # Step 4: Transcribe with Whisper
        logger.debug("Sending to Whisper for transcription")
        transcript = _transcribe_with_whisper(temp_file_path)
        
        if not transcript:
            logger.error("Whisper transcription returned empty")
            _run_async(telegram_client.send_message(chat_id=chat_id, text=ERROR_WHISPER_FAILED))
            return {"success": False, "error": "whisper_empty_transcript"}
        
        logger.debug(
            "Whisper transcription complete",
            transcript_length=len(transcript),
        )
        
        # Step 5: Clean up with Kimi API
        logger.debug("Sending to Kimi for cleanup")
        try:
            cleaned_text = _run_async(kimi_client.cleanup_transcript(transcript))
        except KimiError as e:
            error_str = str(e).lower()
            if "token" in error_str or "length" in error_str or "too long" in error_str:
                logger.warning("Kimi token limit exceeded")
                _run_async(telegram_client.send_message(chat_id=chat_id, text=ERROR_KIMI_TOKEN_LIMIT))
                raise
            raise
        
        if not cleaned_text:
            logger.warning("Kimi cleanup returned empty, using raw transcript")
            cleaned_text = transcript
        
        logger.debug("Kimi cleanup complete", cleaned_length=len(cleaned_text))
        
        # Step 6: Send result to user
        logger.debug("Sending transcription to user")
        _run_async(telegram_client.send_message(chat_id=chat_id, text=cleaned_text))
        
        logger.info(
            "Voice note transcription complete",
            transcript_length=len(transcript),
            cleaned_length=len(cleaned_text),
        )
        
        return {
            "success": True,
            "transcript_length": len(transcript),
            "cleaned_length": len(cleaned_text),
        }
        
    except Exception as e:
        logger.exception("Transcription job failed", error=str(e))
        
        # Send appropriate error message based on exception type
        if telegram_client:
            error_message = _get_error_message_for_exception(e)
            try:
                _run_async(telegram_client.send_message(chat_id=chat_id, text=error_message))
            except Exception as send_error:
                logger.error(
                    "Failed to send error message to user",
                    error=str(send_error),
                )
        
        # Re-raise for RQ retry mechanism
        raise
        
    finally:
        # Clean up clients
        if telegram_client:
            try:
                _run_async(telegram_client.close())
            except Exception:
                pass
        if kimi_client:
            try:
                _run_async(kimi_client.close())
            except Exception:
                pass
        
        # Clean up temp file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.debug("Cleaned up temp file", temp_file=temp_file_path)
            except Exception as e:
                logger.warning(
                    "Failed to clean up temp file",
                    temp_file=temp_file_path,
                    error=str(e),
                )


def _transcribe_with_whisper(audio_file_path: str) -> str | None:
    """
    Send audio file to Whisper service for transcription.
    
    Args:
        audio_file_path: Path to audio file
        
    Returns:
        Transcribed text or None if failed
        
    Raises:
        Exception: If transcription fails
    """
    try:
        with open(audio_file_path, "rb") as audio_file:
            files = {"audio_file": (Path(audio_file_path).name, audio_file)}
            data = {"language": "auto"}
            
            response = httpx.post(
                WHISPER_URL,
                files=files,
                data=data,
                timeout=300.0,  # 5 minutes timeout for long audio
            )
            response.raise_for_status()
            result = response.json()
            
            transcript = result.get("text", "").strip()
            return transcript if transcript else None
            
    except httpx.HTTPStatusError as e:
        logger.error(
            "Whisper HTTP error",
            status_code=e.response.status_code,
            response=e.response.text,
        )
        raise Exception(f"Whisper transcription failed: HTTP {e.response.status_code}")
    except httpx.TimeoutException:
        logger.error("Whisper request timed out")
        raise Exception("Whisper transcription timed out")
    except Exception as e:
        logger.error("Whisper transcription error", error=str(e))
        raise Exception(f"Whisper transcription failed: {e}")


def _get_error_message_for_exception(e: Exception) -> str:
    """
    Get appropriate error message based on exception type.
    
    Args:
        e: The exception that occurred
        
    Returns:
        User-friendly error message
    """
    error_str = str(e).lower()
    
    # Check for token limit errors
    if "token_limit_exceeded" in error_str:
        return ERROR_KIMI_TOKEN_LIMIT
    
    # Check for Kimi errors related to token limits
    if isinstance(e, KimiError):
        if "token" in error_str or "too long" in error_str or e.error_code == 413:
            return ERROR_KIMI_TOKEN_LIMIT
    
    # Check for whisper-related errors
    if "whisper" in error_str:
        return ERROR_WHISPER_FAILED
    
    # Check for file size errors (should be caught earlier, but just in case)
    if "too large" in error_str or "size" in error_str:
        return ERROR_FILE_TOO_LARGE
    
    return ERROR_GENERAL
