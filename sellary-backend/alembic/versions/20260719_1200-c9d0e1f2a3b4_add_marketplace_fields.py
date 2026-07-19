"""add marketplace fields to products and companies

Adds opt-in online-store visibility. products.is_published gates whether a
product appears in the marketplace catalog; products.image_url holds its
Cloudinary image. companies.* configure the shop storefront (branding and the
fulfilment methods it offers). All default to a safe closed state: products
hidden, marketplace disabled, both fulfilment methods available once enabled.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-19 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "is_published", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column("products", sa.Column("image_url", sa.String(500), nullable=True))
    op.add_column(
        "companies",
        sa.Column(
            "is_marketplace_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("companies", sa.Column("logo_url", sa.String(500), nullable=True))
    op.add_column(
        "companies", sa.Column("marketplace_description", sa.String(500), nullable=True)
    )
    op.add_column(
        "companies",
        sa.Column(
            "supports_delivery",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "companies",
        sa.Column(
            "supports_pickup",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "supports_pickup")
    op.drop_column("companies", "supports_delivery")
    op.drop_column("companies", "marketplace_description")
    op.drop_column("companies", "logo_url")
    op.drop_column("companies", "is_marketplace_enabled")
    op.drop_column("products", "image_url")
    op.drop_column("products", "is_published")
