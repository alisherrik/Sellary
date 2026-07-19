"""Merchant can toggle is_published and set image_url via the product update API."""
from fastapi.testclient import TestClient


def test_update_sets_is_published_and_image_url(
    client: TestClient, manager_headers, test_product
):
    resp = client.put(
        f"/api/products/{test_product.id}",
        headers=manager_headers,
        json={"is_published": True, "image_url": "https://cdn.example/x.jpg"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_published"] is True
    assert body["image_url"] == "https://cdn.example/x.jpg"


def test_product_response_defaults_when_not_published(
    client: TestClient, manager_headers, test_product
):
    resp = client.get(f"/api/products/{test_product.id}", headers=manager_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_published"] is False
    assert body["image_url"] is None
