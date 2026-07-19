"""GET/PATCH /api/company/marketplace reads and updates storefront settings."""
from fastapi.testclient import TestClient


def test_get_marketplace_defaults(client: TestClient, manager_headers):
    resp = client.get("/api/company/marketplace", headers=manager_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_marketplace_enabled"] is False
    assert body["supports_delivery"] is True
    assert body["supports_pickup"] is True
    assert body["logo_url"] is None


def test_patch_updates_subset(client: TestClient, manager_headers):
    resp = client.patch(
        "/api/company/marketplace",
        headers=manager_headers,
        json={
            "is_marketplace_enabled": True,
            "marketplace_description": "Best shop",
            "supports_delivery": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_marketplace_enabled"] is True
    assert body["marketplace_description"] == "Best shop"
    assert body["supports_delivery"] is False
    # Untouched field keeps its default.
    assert body["supports_pickup"] is True


def test_patch_requires_auth(client: TestClient):
    resp = client.patch("/api/company/marketplace", json={"is_marketplace_enabled": True})
    assert resp.status_code == 401
