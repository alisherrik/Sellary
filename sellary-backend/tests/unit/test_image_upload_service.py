"""ImageUploadService wraps Cloudinary; behaviour is tested with the SDK mocked."""
import pytest

from services.image_upload_service import ImageUploadService


class _Settings:
    def __init__(self, url):
        self.CLOUDINARY_URL = url


def test_upload_returns_secure_url(monkeypatch):
    captured = {}

    def fake_upload(data, **kwargs):
        captured["data"] = data
        captured["kwargs"] = kwargs
        return {"secure_url": "https://res.cloudinary.com/demo/image/upload/x.jpg"}

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", fake_upload
    )
    service = ImageUploadService(_Settings("cloudinary://k:s@demo"))
    url = service.upload_product_image(b"bytes", filename="photo.jpg")
    assert url == "https://res.cloudinary.com/demo/image/upload/x.jpg"
    assert captured["data"] == b"bytes"
    assert captured["kwargs"]["folder"] == "sellary/products"


def test_upload_unconfigured_raises():
    service = ImageUploadService(_Settings(""))
    with pytest.raises(ValueError, match="not configured"):
        service.upload_product_image(b"bytes", filename="photo.jpg")


def test_upload_sdk_error_raises(monkeypatch):
    def boom(data, **kwargs):
        raise RuntimeError("network")

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", boom
    )
    service = ImageUploadService(_Settings("cloudinary://k:s@demo"))
    with pytest.raises(ValueError, match="failed"):
        service.upload_product_image(b"bytes", filename="photo.jpg")
