def test_get_requires_super_admin(client, admin_headers):
    # a normal company access token must be rejected
    assert client.get("/api/owner/platform-settings", headers=admin_headers).status_code == 401


def test_get_returns_masked_never_plaintext(client, owner_headers, db_session):
    from services.platform_settings_service import PlatformSettingsService
    PlatformSettingsService(db_session).set("telegram_bot_token", "12345SECRETXYZ")
    db_session.commit()
    resp = client.get("/api/owner/platform-settings", headers=owner_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["telegram_bot_token"]["is_set"] is True
    assert body["telegram_bot_token"]["masked"] == "••••TXYZ"
    assert "SECRET" not in resp.text


def test_put_sets_and_blank_preserves(client, owner_headers):
    # set all three
    client.put("/api/owner/platform-settings", headers=owner_headers, json={
        "telegram_bot_token": "botTOKEN1234",
        "telegram_webhook_secret": "hookSECRET",
        "cloudinary_url": "cloudinary://k:s@cloudNAME",
    })
    # second PUT leaves bot token blank → preserved
    resp = client.put("/api/owner/platform-settings", headers=owner_headers, json={
        "telegram_bot_token": "",
        "cloudinary_url": "cloudinary://k:s@newCLOUD",
    })
    body = resp.json()
    assert body["telegram_bot_token"]["masked"] == "••••1234"  # unchanged
    assert body["cloudinary_url"]["masked"] == "••••LOUD"      # replaced


def test_put_requires_super_admin(client, admin_headers):
    assert client.put("/api/owner/platform-settings", headers=admin_headers,
                      json={"telegram_bot_token": "x"}).status_code == 401
