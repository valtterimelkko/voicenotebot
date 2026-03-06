"""Kimi API client for transcript cleanup."""

import os
from typing import Any

import httpx

from .logger import get_logger

logger = get_logger(__name__)


class KimiError(Exception):
    """Base exception for Kimi API errors."""
    
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


class KimiClient:
    """Kimi API client for voice transcript cleanup.
    
    Uses the Kimi coding API to clean up voice transcripts by:
    - Converting American English to British spelling
    - Removing filler words (um, uh, öö, ääh, etc.)
    - Fixing transcription errors
    - Preserving original language
    
    Attributes:
        api_key: Kimi API key from KIMI_API_KEY env var.
        base_url: Kimi API base URL.
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
        """Initialize the Kimi client.
        
        Args:
            api_key: Kimi API key. If None, reads from KIMI_API_KEY env var.
        
        Raises:
            KimiError: If no API key is provided or found in environment.
        """
        self.api_key = api_key or os.getenv("KIMI_API_KEY")
        if not self.api_key:
            raise KimiError(
                "Kimi API key not provided. "
                "Set KIMI_API_KEY environment variable."
            )
        
        self.base_url = "https://api.kimi.com/coding/v1"
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(300.0, connect=30.0),  # 5 min for long transcripts
            follow_redirects=True,
        )
        logger.info("kimi_client_initialized")

    def _get_headers(self) -> dict[str, str]:
        """Get request headers for Kimi API."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "KimiCLI/1.0",
            "Content-Type": "application/json",
        }

    async def cleanup_transcript(self, transcript_text: str) -> str:
        """Clean up a voice transcript using Kimi API.
        
        Sends the transcript to Kimi API with a system prompt that instructs
        the model to clean up filler words, fix errors, and convert to British
        English spelling.
        
        Args:
            transcript_text: Raw transcript text from Whisper.
        
        Returns:
            Cleaned transcript text.
        
        Raises:
            KimiError: If API request fails, rate limited, or response parsing fails.
        
        Example:
            >>> raw = "Um, so like, I was thinking about the color..."
            >>> cleaned = await client.cleanup_transcript(raw)
            >>> print(cleaned)
            "I was thinking about the colour..."
        """
        logger.debug(
            "cleanup_transcript_start",
            transcript_length=len(transcript_text),
        )
        
        url = f"{self.base_url}/chat/completions"
        
        payload: dict[str, Any] = {
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
            "model": "kimi-for-coding",
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
                "kimi_api_error",
                status_code=e.response.status_code,
                error=str(e),
                error_body=error_body,
            )
            
            if e.response.status_code == 429:
                raise KimiError(
                    "Rate limit exceeded. Please try again later.",
                    error_code=429,
                    response_body=error_body,
                )
            elif e.response.status_code == 401:
                raise KimiError(
                    "Invalid API key. Check your KIMI_API_KEY.",
                    error_code=401,
                    response_body=error_body,
                )
            else:
                raise KimiError(
                    f"HTTP error {e.response.status_code}: {str(e)}",
                    error_code=e.response.status_code,
                    response_body=error_body,
                )
        except httpx.TimeoutException as e:
            logger.error(
                "kimi_api_timeout",
                error=str(e),
                transcript_length=len(transcript_text),
            )
            raise KimiError(
                f"Request timed out after 120s: {str(e)}",
                error_code=408,
            )
        except httpx.RequestError as e:
            logger.error(
                "kimi_request_failed",
                error=str(e),
            )
            raise KimiError(f"Request failed: {str(e)}")

        try:
            data = response.json()
        except Exception as e:
            logger.error(
                "kimi_response_parse_error",
                error=str(e),
            )
            raise KimiError(f"Failed to parse response: {str(e)}")

        # Extract cleaned text from response
        try:
            cleaned_text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            logger.error(
                "kimi_response_structure_error",
                response_keys=list(data.keys()) if isinstance(data, dict) else None,
                error=str(e),
            )
            raise KimiError(
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
        logger.debug("kimi_client_closed")

    async def __aenter__(self) -> "KimiClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()
