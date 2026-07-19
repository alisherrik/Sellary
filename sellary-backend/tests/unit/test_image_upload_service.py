"""ImageUploadService wraps Cloudinary; behaviour is tested with the SDK mocked.

After F7 the service takes the resolved Cloudinary URL as a plain string arg
(the caller resolves it via PlatformSettingsService), so it is no longer coupled
to `settings`.
"""
import pytest

from services.image_upload_service import ImageUploadService


def test_upload_returns_secure_url(monkeypatch):
    captured = {}

    def fake_upload(data, **kwargs):
        captured["data"] = data
        captured["kwargs"] = kwargs
        return {"secure_url": "https://res.cloudinary.com/demo/image/upload/x.jpg"}

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", fake_upload
    )
    service = ImageUploadService("cloudinary://k:s@demo")
    url = service.upload_product_image(b"bytes", filename="photo.jpg")
    assert url == "https://res.cloudinary.com/demo/image/upload/x.jpg"
    assert captured["data"] == b"bytes"
    assert captured["kwargs"]["folder"] == "sellary/products"


def test_upload_unconfigured_raises():
    service = ImageUploadService("")
    with pytest.raises(ValueError, match="not configured"):
        service.upload_product_image(b"bytes", filename="photo.jpg")


def test_unconfigured_url_raises_not_configured():
    svc = ImageUploadService("")
    with pytest.raises(ValueError) as exc:
        svc.upload_product_image(b"x", filename="a.png")
    assert "not configured" in str(exc.value)


def test_configures_cloudinary_from_parsed_dsn(monkeypatch):
    # Regression: cloudinary.config(cloudinary_url=...) does NOT parse the DSN,
    # so the credentials must be parsed and passed as explicit fields. Without
    # this, upload fails with "Must supply api_key".
    captured = {}
    monkeypatch.setattr(
        "services.image_upload_service.cloudinary.config",
        lambda **kw: captured.update(kw),
    )
    ImageUploadService("cloudinary://apikey123:secretABC@mycloud")
    assert captured["cloud_name"] == "mycloud"
    assert captured["api_key"] == "apikey123"
    assert captured["api_secret"] == "secretABC"


def test_upload_sdk_error_raises(monkeypatch):
    def boom(data, **kwargs):
        raise RuntimeError("network")

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", boom
    )
    service = ImageUploadService("cloudinary://k:s@demo")
    with pytest.raises(ValueError, match="failed"):
        service.upload_product_image(b"bytes", filename="photo.jpg")
