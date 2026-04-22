"""OpenAI API client for audio transcription."""

import os
from pathlib import Path
from typing import Any

import httpx

from .logger import get_logger

logger = get_logger(__name__)


class OpenAITranscriptionError(Exception):
    """Base exception for OpenAI transcription API errors."""

    def __init__(
        self,
        message: str,
        error_code: int | None = None,
        response_body: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.response_body = response_body


class OpenAITranscriptionClient:
    """OpenAI API client for audio transcription.

    Uses OpenAI's audio transcriptions endpoint with gpt-4o-mini-transcribe
    or gpt-4o-transcribe models for fast, accurate speech-to-text.

    Attributes:
        api_key: OpenAI API key from OPENAI_API_KEY env var.
        model: Transcription model to use.
        base_url: OpenAI API base URL.
        client: httpx client for making requests.
    """

    DEFAULT_MODEL = "gpt-4o-mini-transcribe"
    BASE_URL = "https://api.openai.com/v1"

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        """Initialize the OpenAI transcription client.

        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.
            model: Transcription model. Defaults to gpt-4o-mini-transcribe.

        Raises:
            OpenAITranscriptionError: If no API key is provided or found.
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise OpenAITranscriptionError(
                "OpenAI API key not provided. "
                "Set OPENAI_API_KEY environment variable."
            )

        self.model = model or os.getenv("OPENAI_TRANSCRIPTION_MODEL", self.DEFAULT_MODEL)
        self.client = httpx.Client(
            timeout=httpx.Timeout(120.0, connect=30.0),
            follow_redirects=True,
        )
        logger.info("openai_transcription_client_initialized", model=self.model)

    def _get_headers(self) -> dict[str, str]:
        """Get request headers for OpenAI API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
        }

    def transcribe(self, audio_file_path: str, language: str = "en") -> str:
        """Transcribe an audio file using OpenAI API.

        Args:
            audio_file_path: Path to the audio file.
            language: Language code (e.g., "en", "auto"). OpenAI supports auto-detection.

        Returns:
            Transcribed text.

        Raises:
            OpenAITranscriptionError: If the API request fails.
        """
        logger.debug(
            "openai_transcription_start",
            file=audio_file_path,
            model=self.model,
            language=language,
        )

        url = f"{self.BASE_URL}/audio/transcriptions"

        # Determine MIME type based on file extension
        file_ext = Path(audio_file_path).suffix.lower()
        mime_types = {
            ".oga": "audio/ogg",
            ".ogg": "audio/ogg",
            ".mp3": "audio/mpeg",
            ".m4a": "audio/mp4",
            ".wav": "audio/wav",
            ".webm": "audio/webm",
            ".mp4": "audio/mp4",
        }
        mime_type = mime_types.get(file_ext, "audio/ogg")

        try:
            with open(audio_file_path, "rb") as audio_file:
                files = {
                    "file": (Path(audio_file_path).name, audio_file, mime_type),
                }
                data = {
                    "model": self.model,
                    "language": language if language != "auto" else "",
                    "response_format": "json",
                }
                # Remove empty language to let OpenAI auto-detect
                if not data["language"]:
                    del data["language"]

                response = self.client.post(
                    url,
                    headers=self._get_headers(),
                    files=files,
                    data=data,
                )

            logger.debug(
                "openai_transcription_response",
                status_code=response.status_code,
                content_preview=response.text[:200] if response.text else "(empty)",
            )

            response.raise_for_status()

            result = response.json()
            transcript = result.get("text", "").strip()

            logger.info(
                "openai_transcription_complete",
                transcript_length=len(transcript),
                model=self.model,
            )

            return transcript

        except httpx.HTTPStatusError as e:
            error_body = None
            try:
                error_body = e.response.json()
            except Exception:
                pass

            logger.error(
                "openai_transcription_http_error",
                status_code=e.response.status_code,
                error=str(e),
                error_body=error_body,
            )

            if e.response.status_code == 429:
                raise OpenAITranscriptionError(
                    "Rate limit exceeded. Please try again later.",
                    error_code=429,
                    response_body=error_body,
                )
            elif e.response.status_code == 401:
                raise OpenAITranscriptionError(
                    "Invalid API key. Check your OPENAI_API_KEY.",
                    error_code=401,
                    response_body=error_body,
                )
            elif e.response.status_code == 413:
                raise OpenAITranscriptionError(
                    "File too large for OpenAI API.",
                    error_code=413,
                    response_body=error_body,
                )
            else:
                raise OpenAITranscriptionError(
                    f"HTTP error {e.response.status_code}: {str(e)}",
                    error_code=e.response.status_code,
                    response_body=error_body,
                )

        except httpx.TimeoutException as e:
            logger.error("openai_transcription_timeout", error=str(e))
            raise OpenAITranscriptionError(
                "Request timed out.",
                error_code=408,
            )

        except httpx.RequestError as e:
            logger.error("openai_transcription_request_error", error=str(e))
            raise OpenAITranscriptionError(f"Request failed: {str(e)}")

        except Exception as e:
            logger.error("openai_transcription_unexpected_error", error=str(e))
            raise OpenAITranscriptionError(f"Unexpected error: {str(e)}")

    def close(self) -> None:
        """Close the HTTP client."""
        self.client.close()
        logger.debug("openai_transcription_client_closed")

    def __enter__(self) -> "OpenAITranscriptionClient":
        """Context manager entry."""
        return self

    def __exit__(self, *args: Any) -> None:
        """Context manager exit."""
        self.close()
