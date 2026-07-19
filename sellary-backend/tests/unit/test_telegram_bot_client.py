import httpx
import json
import pytest
from services.telegram_bot_client import TelegramBotClient


def _client(handler):
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    return TelegramBotClient(bot_token="TESTTOKEN", base_url="https://api.telegram.org", http=http)


def test_send_message_posts_expected_request():
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True})

    _client(handler).send_message("999", "hi")
    assert captured["url"] == "https://api.telegram.org/botTESTTOKEN/sendMessage"
    assert captured["body"] == {"chat_id": "999", "text": "hi"}


def test_send_message_raises_on_http_error():
    def handler(request):
        return httpx.Response(403, json={"ok": False, "description": "blocked"})

    with pytest.raises(Exception):
        _client(handler).send_message("999", "hi")


def test_send_message_raises_on_network_error():
    def handler(request):
        raise httpx.ConnectError("boom")

    with pytest.raises(Exception):
        _client(handler).send_message("999", "hi")
