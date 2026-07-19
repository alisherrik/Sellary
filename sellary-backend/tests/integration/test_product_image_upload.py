"""POST /api/products/{id}/image uploads via Cloudinary (mocked) and persists the URL."""
import io

from fastapi.testclient import TestClient


def _patch_upload(monkeypatch, url="https://cdn.example/uploaded.jpg"):
    monkeypatch.setattr(
        "services.image_upload_service.ImageUploadService.upload_product_image",
        lambda self, data, *, filename: url,
    )


def test_upload_persists_image_url(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff jpeg"), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_url"] == "https://cdn.example/uploaded.jpg"


def test_upload_rejects_non_image(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("doc.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert resp.status_code == 400, resp.text


def test_upload_missing_product_404(
    client: TestClient, manager_headers, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        "/api/products/999999/image",
        headers=manager_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff"), "image/jpeg")},
    )
    assert resp.status_code == 404, resp.text


def test_upload_rejects_oversize_400(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    _patch_upload(monkeypatch)
    oversize_body = b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 1)
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("big.jpg", io.BytesIO(oversize_body), "image/jpeg")},
    )
    assert resp.status_code == 400, resp.text


def test_upload_unconfigured_service_503(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    def _raise_unconfigured(self, data, *, filename):
        raise ValueError("Image upload not configured")

    monkeypatch.setattr(
        "services.image_upload_service.ImageUploadService.upload_product_image",
        _raise_unconfigured,
    )
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff jpeg"), "image/jpeg")},
    )
    assert resp.status_code == 503, resp.text
