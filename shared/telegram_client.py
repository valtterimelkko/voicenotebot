"""Telegram Bot API client for VoiceNote Bot."""

import os
from typing import Any
from io import BytesIO

import httpx

from .logger import get_logger

logger = get_logger(__name__)


class TelegramError(Exception):
    """Base exception for Telegram API errors."""
    
    def __init__(self, message: str, error_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class TelegramClient:
    """Async Telegram Bot API client.
    
    Handles file retrieval, downloads, and message sending with
    proper error handling and logging.
    
    Attributes:
        token: Telegram bot token from TELEGRAM_BOT_TOKEN env var.
        base_url: Telegram API base URL.
        client: httpx.AsyncClient for making requests.
    """

    def __init__(self, token: str | None = None) -> None:
        """Initialize the Telegram client.
        
        Args:
            token: Bot token. If None, reads from TELEGRAM_BOT_TOKEN env var.
        
        Raises:
            TelegramError: If no token is provided or found in environment.
        """
        self.token = token or os.getenv("TELEGRAM_BOT_TOKEN")
        if not self.token:
            raise TelegramError(
                "Telegram bot token not provided. "
                "Set TELEGRAM_BOT_TOKEN environment variable."
            )
        
        self.base_url = f"https://api.telegram.org/bot{self.token}"
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        )
        logger.info("telegram_client_initialized")

    async def get_file(self, file_id: str) -> dict[str, Any]:
        """Get file information from Telegram.
        
        Args:
            file_id: Telegram file identifier.
        
        Returns:
            File info dict containing file_id, file_unique_id, file_size,
            and file_path for the file on Telegram servers.
        
        Raises:
            TelegramError: If the API request fails or file not found.
        
        Example:
            >>> file_info = await client.get_file("ABC123")
            >>> print(file_info["file_path"])
            "voice/file_123.oga"
        """
        logger.debug("getting_file_info", file_id=file_id)
        
        url = f"{self.base_url}/getFile"
        
        try:
            response = await self.client.post(url, json={"file_id": file_id})
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "telegram_api_error",
                endpoint="getFile",
                status_code=e.response.status_code,
                error=str(e),
            )
            raise TelegramError(
                f"HTTP error getting file: {e.response.status_code}",
                error_code=e.response.status_code,
            )
        except httpx.RequestError as e:
            logger.error(
                "telegram_request_failed",
                endpoint="getFile",
                error=str(e),
            )
            raise TelegramError(f"Request failed: {str(e)}")

        data = response.json()
        
        if not data.get("ok"):
            error_desc = data.get("description", "Unknown error")
            logger.error(
                "telegram_api_error",
                endpoint="getFile",
                description=error_desc,
            )
            raise TelegramError(f"Telegram API error: {error_desc}")
        
        result = data["result"]
        logger.debug(
            "file_info_retrieved",
            file_id=file_id,
            file_path=result.get("file_path"),
            file_size=result.get("file_size"),
        )
        return result

    async def download_file(self, file_path: str) -> bytes:
        """Download a file from Telegram servers.
        
        Args:
            file_path: File path from get_file() response.
        
        Returns:
            Raw file bytes.
        
        Raises:
            TelegramError: If download fails.
        
        Example:
            >>> file_bytes = await client.download_file("voice/file_123.oga")
            >>> len(file_bytes)
            45678
        """
        logger.debug("downloading_file", file_path=file_path)
        
        # File download URL is different from API URL
        download_url = f"https://api.telegram.org/file/bot{self.token}/{file_path}"
        
        try:
            response = await self.client.get(download_url)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "file_download_error",
                file_path=file_path,
                status_code=e.response.status_code,
                error=str(e),
            )
            raise TelegramError(
                f"HTTP error downloading file: {e.response.status_code}",
                error_code=e.response.status_code,
            )
        except httpx.RequestError as e:
            logger.error(
                "file_download_failed",
                file_path=file_path,
                error=str(e),
            )
            raise TelegramError(f"Download request failed: {str(e)}")

        content = response.content
        logger.info(
            "file_downloaded",
            file_path=file_path,
            bytes_downloaded=len(content),
        )
        return content

    async def send_message(
        self,
        chat_id: int | str,
        text: str,
        reply_to_message_id: int | None = None,
        parse_mode: str | None = None,
    ) -> dict[str, Any]:
        """Send a text message to a chat.
        
        Args:
            chat_id: Target chat ID or username.
            text: Message text to send.
            reply_to_message_id: Optional message ID to reply to.
            parse_mode: Optional parse mode ("HTML" or "Markdown").
        
        Returns:
            Sent message info from Telegram API.
        
        Raises:
            TelegramError: If sending fails.
        
        Example:
            >>> result = await client.send_message(
            ...     chat_id=123456,
            ...     text="Hello!",
            ...     reply_to_message_id=789
            ... )
        """
        logger.debug(
            "sending_message",
            chat_id=chat_id,
            reply_to=reply_to_message_id,
            text_length=len(text),
        )
        
        url = f"{self.base_url}/sendMessage"
        
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
        }
        
        if reply_to_message_id:
            payload["reply_to_message_id"] = reply_to_message_id
        
        if parse_mode:
            payload["parse_mode"] = parse_mode

        try:
            response = await self.client.post(url, json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "send_message_error",
                chat_id=chat_id,
                status_code=e.response.status_code,
                error=str(e),
            )
            raise TelegramError(
                f"HTTP error sending message: {e.response.status_code}",
                error_code=e.response.status_code,
            )
        except httpx.RequestError as e:
            logger.error(
                "send_message_failed",
                chat_id=chat_id,
                error=str(e),
            )
            raise TelegramError(f"Send request failed: {str(e)}")

        data = response.json()
        
        if not data.get("ok"):
            error_desc = data.get("description", "Unknown error")
            logger.error(
                "telegram_api_error",
                endpoint="sendMessage",
                description=error_desc,
            )
            raise TelegramError(f"Telegram API error: {error_desc}")

        result = data["result"]
        logger.info(
            "message_sent",
            chat_id=chat_id,
            message_id=result.get("message_id"),
            text_length=len(text),
        )
        return result

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()
        logger.debug("telegram_client_closed")

    async def __aenter__(self) -> "TelegramClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()
