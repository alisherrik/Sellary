"""add oauth tables for the MCP connector

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-07-27 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("client_id", sa.String(length=64), primary_key=True),
        sa.Column("client_secret_enc", sa.String(length=400), nullable=True),
        sa.Column("client_name", sa.String(length=200), nullable=True),
        sa.Column("redirect_uris", sa.JSON(), nullable=False),
        sa.Column("grant_types", sa.JSON(), nullable=False),
        sa.Column("response_types", sa.JSON(), nullable=False),
        sa.Column("scope", sa.String(length=200), nullable=True),
        sa.Column(
            "token_endpoint_auth_method",
            sa.String(length=40),
            nullable=False,
            server_default="none",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )

    op.create_table(
        "oauth_auth_codes",
        sa.Column("code", sa.String(length=64), primary_key=True),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("redirect_uri", sa.String(length=500), nullable=False),
        sa.Column(
            "redirect_uri_provided_explicitly",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("code_challenge", sa.String(length=200), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("resource", sa.String(length=500), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_oauth_auth_codes_expires_at", "oauth_auth_codes", ["expires_at"]
    )

    op.create_table(
        "oauth_refresh_tokens",
        sa.Column("token_hash", sa.String(length=64), primary_key=True),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_oauth_refresh_tokens_user_id", "oauth_refresh_tokens", ["user_id"]
    )
    op.create_index(
        "ix_oauth_refresh_tokens_expires_at", "oauth_refresh_tokens", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_oauth_refresh_tokens_expires_at", "oauth_refresh_tokens")
    op.drop_index("ix_oauth_refresh_tokens_user_id", "oauth_refresh_tokens")
    op.drop_table("oauth_refresh_tokens")
    op.drop_index("ix_oauth_auth_codes_expires_at", "oauth_auth_codes")
    op.drop_table("oauth_auth_codes")
    op.drop_table("oauth_clients")
