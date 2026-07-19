"""Upload product images to Cloudinary and return their CDN URL.

Cloudinary is configured from a single CLOUDINARY_URL DSN. When it is unset
(local dev without an account), uploads raise a configuration error the API
layer turns into a 503, so the rest of the app runs without image hosting.
"""
from __future__ import annotations

import cloudinary
from cloudinary import uploader as cloudinary_uploader

PRODUCT_IMAGE_FOLDER = "sellary/products"


class ImageUploadService:
    def __init__(self, cloudinary_url: str) -> None:
        self._url = cloudinary_url or ""
        if self._url:
            # cloudinary.config() reads CLOUDINARY_URL from the environment, but we
            # pass it explicitly so the service is not coupled to process env state.
            cloudinary.config(cloudinary_url=self._url)

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
            raise ValueError("Image upload failed") from exc
        secure_url = result.get("secure_url")
        if not secure_url:
            raise ValueError("Image upload failed")
        return secure_url
