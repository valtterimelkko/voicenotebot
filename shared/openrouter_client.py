"""OpenRouter API client for transcript cleanup via GPT-5 nano."""

import os
from typing import Any

import httpx

from .logger import get_logger

logger = get_logger(__name__)


class OpenRouterError(Exception):
    """Base exception for OpenRouter API errors."""

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


class OpenRouterClient:
    """OpenRouter API client for voice transcript cleanup.

    Uses GPT-5 nano via OpenRouter to clean up voice transcripts by:
    - Converting American English to British spelling
    - Removing filler words (um, uh, öö, ääh, etc.)
    - Fixing transcription errors
    - Preserving original language

    OpenRouter provides resilience by routing across multiple inference
    providers (OpenAI, Azure, etc.) if one is unavailable.

    Attributes:
        api_key: OpenRouter API key from OPENROUTER_API_KEY env var.
        base_url: OpenRouter API base URL.
        client: httpx.AsyncClient for making requests.
    """

    # System prompt for transcript cleanup
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
        """Initialize the OpenRouter client.

        Args:
            api_key: OpenRouter API key. If None, reads from OPENROUTER_API_KEY env var.

        Raises:
            OpenRouterError: If no API key is provided or found in environment.
        """
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise OpenRouterError(
                "OpenRouter API key not provided. "
                "Set OPENROUTER_API_KEY environment variable."
            )

        self.base_url = "https://openrouter.ai/api/v1"
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(300.0, connect=30.0),
            follow_redirects=True,
        )
        logger.info("openrouter_client_initialized")

    def _get_headers(self) -> dict[str, str]:
        """Get request headers for OpenRouter API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://voicenotebot.local",
            "X-Title": "VoiceNote Bot",
        }

    async def cleanup_transcript(self, transcript_text: str) -> str:
        """Clean up a voice transcript using OpenRouter GPT-5 nano.

        Args:
            transcript_text: Raw transcript text from Whisper.

        Returns:
            Cleaned transcript text.

        Raises:
            OpenRouterError: If API request fails, rate limited, or response parsing fails.
        """
        logger.debug(
            "cleanup_transcript_start",
            transcript_length=len(transcript_text),
        )

        url = f"{self.base_url}/chat/completions"

        payload: dict[str, Any] = {
            "model": "openai/gpt-5-nano",
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
            "temperature": 0.3,
            "max_tokens": 60000,
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
                "openrouter_api_error",
                status_code=e.response.status_code,
                error=str(e),
                error_body=error_body,
            )

            if e.response.status_code == 429:
                raise OpenRouterError(
                    "Rate limit exceeded. Please try again later.",
                    error_code=429,
                    response_body=error_body,
                )
            elif e.response.status_code == 401:
                raise OpenRouterError(
                    "Invalid API key. Check your OPENROUTER_API_KEY.",
                    error_code=401,
                    response_body=error_body,
                )
            else:
                raise OpenRouterError(
                    f"HTTP error {e.response.status_code}: {str(e)}",
                    error_code=e.response.status_code,
                    response_body=error_body,
                )
        except httpx.TimeoutException as e:
            logger.error(
                "openrouter_api_timeout",
                error=str(e),
                transcript_length=len(transcript_text),
            )
            raise OpenRouterError(
                f"Request timed out: {str(e)}",
                error_code=408,
            )
        except httpx.RequestError as e:
            logger.error(
                "openrouter_request_failed",
                error=str(e),
            )
            raise OpenRouterError(f"Request failed: {str(e)}")

        try:
            data = response.json()
        except Exception as e:
            logger.error(
                "openrouter_response_parse_error",
                error=str(e),
            )
            raise OpenRouterError(f"Failed to parse response: {str(e)}")

        if "error" in data:
            logger.error(
                "openrouter_api_error_in_response",
                error=data["error"],
            )
            raise OpenRouterError(
                f"API error: {data['error']}",
                response_body=data,
            )

        # Extract cleaned text from response
        try:
            cleaned_text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            logger.error(
                "openrouter_response_structure_error",
                response_keys=list(data.keys()) if isinstance(data, dict) else None,
                error=str(e),
            )
            raise OpenRouterError(
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
        logger.debug("openrouter_client_closed")

    async def __aenter__(self) -> "OpenRouterClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()
