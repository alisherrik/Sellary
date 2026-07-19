"""Upload product images to Cloudinary and return their CDN URL.

Cloudinary is configured from a single CLOUDINARY_URL DSN. When it is unset
(local dev without an account), uploads raise a configuration error the API
layer turns into a 503, so the rest of the app runs without image hosting.
"""
from __future__ import annotations

from urllib.parse import urlparse

import cloudinary
from cloudinary import uploader as cloudinary_uploader

PRODUCT_IMAGE_FOLDER = "sellary/products"


class ImageUploadService:
    def __init__(self, cloudinary_url: str) -> None:
        self._url = cloudinary_url or ""
        if self._url:
            # cloudinary.config(cloudinary_url=...) does NOT parse the DSN — the SDK
            # only auto-parses CLOUDINARY_URL from the environment at import time.
            # Passing it as a kwarg leaves api_key unset ("Must supply api_key" on
            # upload). Parse the DSN and configure the credentials explicitly.
            parsed = urlparse(self._url)
            cloudinary.config(
                cloud_name=parsed.hostname,
                api_key=parsed.username,
                api_secret=parsed.password,
                secure=True,
            )

    def upload_product_image(self, data: bytes, *, filename: str) -> str:
        if not self._url:
            raise ValueError("Image upload not configured")
        try:
            result = cloudinary_uploader.upload(
                data,
                folder=PRODUCT_IMAGE_FOLDER,
                resource_type="image",
                # Cap stored size; Cloudinary re-encodes/optimises on delivery.
                transformation=[{"width": 1600, "height": 1600, "crop": "limit"}],
            )
        except Exception as exc:  # SDK raises various error types
            # Surface the underlying cause (e.g. "Invalid api_key", "Invalid
            # Signature") so a merchant can fix a wrong CLOUDINARY_URL. Cloudinary
            # error messages don't echo the api_secret, so this is safe to return.
            raise ValueError(f"Image upload failed: {exc}") from exc
        secure_url = result.get("secure_url")
        if not secure_url:
            raise ValueError("Image upload failed: no URL returned")
        return secure_url
