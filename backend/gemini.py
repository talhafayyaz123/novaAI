import json
import os
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

import httpx


GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiError(RuntimeError):
    pass


class GeminiConfigurationError(GeminiError):
    pass


class GeminiBlockedError(GeminiError):
    pass


def _response_text(payload: dict[str, Any]) -> str:
    feedback = payload.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        raise GeminiBlockedError("Gemini blocked the prompt for safety reasons")

    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise GeminiError("Gemini returned no answer candidates")
    candidate = candidates[0]
    if not isinstance(candidate, dict):
        raise GeminiError("Gemini returned an invalid answer candidate")
    if candidate.get("finishReason") in {
        "SAFETY",
        "RECITATION",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
    }:
        raise GeminiBlockedError("Gemini blocked the response for safety reasons")
    content = candidate.get("content")
    parts = content.get("parts", []) if isinstance(content, dict) else []
    answer = "".join(
        part["text"]
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ).strip()
    if not answer:
        raise GeminiError("Gemini returned an empty answer")
    return answer


class GeminiClient:
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.model = model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        if not self.api_key:
            raise GeminiConfigurationError("GEMINI_API_KEY is not configured")
        self.url = f"{GEMINI_API_BASE_URL}/{quote(self.model, safe='')}"
        self.last_usage_tokens: int | None = None

    @staticmethod
    def _body(
        prompt: str,
        response_mime_type: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
        if response_mime_type:
            body["generationConfig"] = {"responseMimeType": response_mime_type}
        return body

    def generate(
        self,
        prompt: str,
        streaming: bool = False,
        response_mime_type: str | None = None,
    ) -> str | Iterator[str]:
        if streaming:
            return self.generate_stream(prompt)
        try:
            with httpx.Client(timeout=httpx.Timeout(90, connect=10)) as client:
                response = client.post(
                    f"{self.url}:generateContent",
                    headers={"x-goog-api-key": self.api_key},
                    json=self._body(prompt, response_mime_type),
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise GeminiError(
                f"Gemini returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.RequestError as exc:
            raise GeminiError("Could not connect to Gemini") from exc
        except json.JSONDecodeError as exc:
            raise GeminiError("Gemini returned an invalid response") from exc
        usage = payload.get("usageMetadata")
        if isinstance(usage, dict):
            total_tokens = usage.get("totalTokenCount")
            if isinstance(total_tokens, int):
                self.last_usage_tokens = total_tokens
        return _response_text(payload)

    def generate_stream(self, prompt: str) -> Iterator[str]:
        stream_url = f"{self.url}:streamGenerateContent?alt=sse"
        timeout = httpx.Timeout(connect=10, read=90, write=20, pool=10)
        try:
            with httpx.Client(timeout=timeout) as client:
                with client.stream(
                    "POST",
                    stream_url,
                    headers={"x-goog-api-key": self.api_key},
                    json=self._body(prompt),
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data:
                            continue
                        try:
                            payload = json.loads(data)
                        except json.JSONDecodeError as exc:
                            raise GeminiError(
                                "Gemini returned an invalid streaming response"
                            ) from exc
                        feedback = payload.get("promptFeedback")
                        if isinstance(feedback, dict) and feedback.get("blockReason"):
                            raise GeminiBlockedError(
                                "Gemini blocked the prompt for safety reasons"
                            )
                        candidates = payload.get("candidates", [])
                        if not candidates:
                            continue
                        candidate = candidates[0]
                        if candidate.get("finishReason") in {
                            "SAFETY",
                            "RECITATION",
                            "BLOCKLIST",
                            "PROHIBITED_CONTENT",
                            "SPII",
                        }:
                            raise GeminiBlockedError(
                                "Gemini blocked the response for safety reasons"
                            )
                        content = candidate.get("content", {})
                        parts = content.get("parts", []) if isinstance(content, dict) else []
                        for part in parts:
                            text = part.get("text") if isinstance(part, dict) else None
                            if isinstance(text, str) and text:
                                yield text
        except httpx.HTTPStatusError as exc:
            raise GeminiError(
                f"Gemini returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.RequestError as exc:
            raise GeminiError("Could not connect to Gemini") from exc
