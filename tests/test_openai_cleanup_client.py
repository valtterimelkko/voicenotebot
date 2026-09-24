"""Tests for the OpenAI transcript cleanup client (replaces Kimi/OpenRouter cleanup).

Behaviour under test:
- Cleanup uses OpenAI's chat completions API directly (api.openai.com)
- Model is "gpt-5-nano"
- Auth reads OPENAI_API_KEY (same key-fetching mechanism as the OpenAI
  transcription client and the streaming-dictation backend)
- No Kimi or OpenRouter endpoint is ever contacted
"""

import os

import httpx
import pytest
import respx
from httpx import Response

from shared.openai_cleanup_client import OpenAICleanupClient, OpenAICleanupError

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


@pytest.fixture(autouse=True)
def _openai_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test_openai_key_12345")


class TestOpenAICleanupClientInit:
    def test_reads_api_key_from_env(self):
        client = OpenAICleanupClient()
        assert client.api_key == "test_openai_key_12345"

    def test_missing_api_key_raises(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(OpenAICleanupError):
            OpenAICleanupClient()

    def test_accepts_explicit_api_key(self):
        client = OpenAICleanupClient(api_key="explicit_key")
        assert client.api_key == "explicit_key"


@pytest.mark.asyncio
class TestOpenAICleanupClientRequest:
    async def test_calls_openai_endpoint_with_gpt5_nano(self, respx_mock: respx.MockRouter):
        route = respx_mock.post(OPENAI_CHAT_URL).mock(
            return_value=Response(
                200,
                json={"choices": [{"message": {"content": "Cleaned text."}}]},
            )
        )

        client = OpenAICleanupClient()
        result = await client.cleanup_transcript("um so like, the color is nice")
        await client.close()

        assert result == "Cleaned text."
        assert route.called
        request = route.calls[0].request
        assert request.url == OPENAI_CHAT_URL
        assert request.headers["Authorization"] == "Bearer test_openai_key_12345"

        import json
        body = json.loads(request.content)
        assert body["model"] == "gpt-5-nano"
        assert body["messages"][1]["content"].endswith("um so like, the color is nice")
        # gpt-5-nano only supports the default temperature (1) — passing
        # any other value (e.g. 0.3) is rejected with a 400 "Unsupported
        # value" error, so the request must omit the parameter entirely.
        assert "temperature" not in body

    async def test_never_calls_kimi_or_openrouter_endpoints(self, respx_mock: respx.MockRouter):
        respx_mock.post(OPENAI_CHAT_URL).mock(
            return_value=Response(200, json={"choices": [{"message": {"content": "ok"}}]})
        )
        kimi_route = respx_mock.post("https://api.kimi.com/coding/v1/chat/completions").mock(
            return_value=Response(200, json={"choices": [{"message": {"content": "should not be called"}}]})
        )
        openrouter_route = respx_mock.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=Response(200, json={"choices": [{"message": {"content": "should not be called"}}]})
        )

        client = OpenAICleanupClient()
        await client.cleanup_transcript("raw text")
        await client.close()

        assert not kimi_route.called
        assert not openrouter_route.called

    async def test_raises_on_401(self, respx_mock: respx.MockRouter):
        respx_mock.post(OPENAI_CHAT_URL).mock(
            return_value=Response(401, json={"error": {"message": "invalid api key"}})
        )
        client = OpenAICleanupClient()
        with pytest.raises(OpenAICleanupError) as exc_info:
            await client.cleanup_transcript("raw text")
        await client.close()
        assert exc_info.value.error_code == 401

    async def test_raises_on_429(self, respx_mock: respx.MockRouter):
        respx_mock.post(OPENAI_CHAT_URL).mock(
            return_value=Response(429, json={"error": {"message": "rate limited"}})
        )
        client = OpenAICleanupClient()
        with pytest.raises(OpenAICleanupError) as exc_info:
            await client.cleanup_transcript("raw text")
        await client.close()
        assert exc_info.value.error_code == 429

    async def test_raises_on_timeout(self, respx_mock: respx.MockRouter):
        respx_mock.post(OPENAI_CHAT_URL).mock(side_effect=httpx.TimeoutException("timed out"))
        client = OpenAICleanupClient()
        with pytest.raises(OpenAICleanupError):
            await client.cleanup_transcript("raw text")
        await client.close()
