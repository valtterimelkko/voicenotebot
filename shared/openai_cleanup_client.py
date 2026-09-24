"""OpenAI API client for transcript cleanup.

Replaces the previous Kimi (api.kimi.com) and OpenRouter cleanup paths.
The Kimi API key was deleted (leaked, subscription expired); this client
calls OpenAI's chat completions API directly with gpt-5-nano, using the
same OPENAI_API_KEY key-fetching mechanism as the streaming-dictation
backend's cleanup service and this repo's OpenAI transcription client.
"""

import os
from typing import Any

import httpx

from .logger import get_logger

logger = get_logger(__name__)


class OpenAICleanupError(Exception):
    """Base exception for OpenAI cleanup API errors."""

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


class OpenAICleanupClient:
    """OpenAI API client for voice transcript cleanup.

    Uses OpenAI's chat completions API (gpt-5-nano) to clean up voice
    transcripts by:
    - Converting American English to British spelling
    - Removing filler words (um, uh, öö, ääh, etc.)
    - Fixing transcription errors
    - Preserving original language

    Attributes:
        api_key: OpenAI API key from OPENAI_API_KEY env var.
        base_url: OpenAI API base URL.
        client: httpx.AsyncClient for making requests.
    """

    MODEL = "gpt-5-nano"
    BASE_URL = "https://api.openai.com/v1"

    # System prompt for transcript cleanup (same wording used by the
    # streaming-dictation backend's cleanup service, for consistent output).
    SYSTEM_PROMPT = (
        "You are a transcription editor. Clean up voice transcripts with a LIGHT touch:\n"
        "1. Fix spelling and grammar mistakes only when they're clearly wrong\n"
        "2. Convert American spellings to British (color→colour, organize→organise, etc.)\n"
        "3. Remove filler words (um, uh, mmm, ooh, aah, öö, ääh, etc.)\n"
        "4. Fix obvious transcription errors\n"
        "5. Preserve the original language (don't translate)\n"
        "6. IMPORTANT: Keep the speaker's authentic voice, quirks, and natural speech patterns\n"
        "   - Do NOT remove sentences or restructure the flow\n"
        "   - Do NOT replace words just to make it sound more 'proper' or 'perfect'\n"
        "   - Do NOT smooth out rough edges or back-and-forth thinking\n"
        "   - Preserve non-native speaker expressions and authentic word choices\n"
        "   - Keep fragmented sentences if that's how the person speaks\n"
        "   - The transcript will be used for prompting LLMs, not for publication\n\n"
        "Return ONLY the cleaned text, nothing else."
    )

    def __init__(self, api_key: str | None = None) -> None:
        """Initialize the OpenAI cleanup client.

        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.

        Raises:
            OpenAICleanupError: If no API key is provided or found in environment.
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise OpenAICleanupError(
                "OpenAI API key not provided. "
                "Set OPENAI_API_KEY environment variable."
            )

        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(300.0, connect=30.0),  # 5 min for long transcripts
            follow_redirects=True,
        )
        logger.info("openai_cleanup_client_initialized", model=self.MODEL)

    def _get_headers(self) -> dict[str, str]:
        """Get request headers for OpenAI API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def cleanup_transcript(self, transcript_text: str) -> str:
        """Clean up a voice transcript using OpenAI's chat completions API.

        Args:
            transcript_text: Raw transcript text from Whisper.

        Returns:
            Cleaned transcript text.

        Raises:
            OpenAICleanupError: If API request fails, rate limited, or
                response parsing fails.
        """
        logger.debug(
            "cleanup_transcript_start",
            transcript_length=len(transcript_text),
        )

        url = f"{self.BASE_URL}/chat/completions"

        payload: dict[str, Any] = {
            "model": self.MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": self.SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": f"Clean up this transcript:\n\n{transcript_text}",
                },
            ],
            # Note: gpt-5-nano rejects two legacy chat-completions params
            # that earlier cleanup clients (Kimi, OpenRouter) used to send:
            # - "max_tokens" (400: "Unsupported parameter... Use
            #   'max_completion_tokens' instead")
            # - any "temperature" other than the default of 1 (400:
            #   "Unsupported value... Only the default (1) value is
            #   supported")
            # Both are intentionally omitted; this matches the
            # streaming-dictation backend's proven-working OpenAI SDK call
            # (src/services/cleanup.ts).
        }

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            error_body = None
            try:
                error_body = e.response.json()
            except Exception:
                pass

            logger.error(
                "openai_cleanup_api_error",
                status_code=e.response.status_code,
                error=str(e),
                error_body=error_body,
            )

            if e.response.status_code == 429:
                raise OpenAICleanupError(
                    "Rate limit exceeded. Please try again later.",
                    error_code=429,
                    response_body=error_body,
                )
            elif e.response.status_code == 401:
                raise OpenAICleanupError(
                    "Invalid API key. Check your OPENAI_API_KEY.",
                    error_code=401,
                    response_body=error_body,
                )
            else:
                raise OpenAICleanupError(
                    f"HTTP error {e.response.status_code}: {str(e)}",
                    error_code=e.response.status_code,
                    response_body=error_body,
                )
        except httpx.TimeoutException as e:
            logger.error(
                "openai_cleanup_api_timeout",
                error=str(e),
                transcript_length=len(transcript_text),
            )
            raise OpenAICleanupError(
                f"Request timed out: {str(e)}",
                error_code=408,
            )
        except httpx.RequestError as e:
            logger.error(
                "openai_cleanup_request_failed",
                error=str(e),
            )
            raise OpenAICleanupError(f"Request failed: {str(e)}")

        try:
            data = response.json()
        except Exception as e:
            logger.error(
                "openai_cleanup_response_parse_error",
                error=str(e),
            )
            raise OpenAICleanupError(f"Failed to parse response: {str(e)}")

        if "error" in data:
            logger.error(
                "openai_cleanup_api_error_in_response",
                error=data["error"],
            )
            raise OpenAICleanupError(
                f"API error: {data['error']}",
                response_body=data,
            )

        # Extract cleaned text from response
        try:
            cleaned_text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            logger.error(
                "openai_cleanup_response_structure_error",
                response_keys=list(data.keys()) if isinstance(data, dict) else None,
                error=str(e),
            )
            raise OpenAICleanupError(
                f"Unexpected response structure: {str(e)}",
                response_body=data,
            )

        # Strip any extra whitespace
        cleaned_text = cleaned_text.strip()

        logger.info(
            "transcript_cleaned",
            original_length=len(transcript_text),
            cleaned_length=len(cleaned_text),
        )

        return cleaned_text

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()
        logger.debug("openai_cleanup_client_closed")

    async def __aenter__(self) -> "OpenAICleanupClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()
