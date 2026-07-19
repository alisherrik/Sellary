"""Thin Bot API wrapper (sendMessage only, MVP). Injectable httpx.Client so
tests supply a MockTransport — no test ever performs a real network call."""
from __future__ import annotations
import httpx


class TelegramBotClient:
    def __init__(
        self,
        *,
        bot_token: str,
        base_url: str = "https://api.telegram.org",
        http: httpx.Client | None = None,
        timeout: float = 5.0,
    ):
        self._token = bot_token
        self._base = base_url.rstrip("/")
        self._http = http or httpx.Client(timeout=timeout)

    def send_message(self, chat_id: str, text: str) -> None:
        resp = self._http.post(
            f"{self._base}/bot{self._token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
        )
        resp.raise_for_status()
