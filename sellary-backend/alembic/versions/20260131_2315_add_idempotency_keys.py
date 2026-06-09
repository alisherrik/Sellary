"""Add idempotency_keys table

Revision ID: 20260131_2315_add_idempotency_keys
Revises: 20260131_1730
Create Date: 2026-01-31 23:15:00
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260131_2315'
down_revision = '20260131_1730'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'idempotency_keys',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('key', sa.String(64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('endpoint', sa.String(255), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('response_body', sa.Text(), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )
    
    # Create unique index on (key, user_id, endpoint)
    op.create_index(
        'ix_idempotency_key_user_endpoint',
        'idempotency_keys',
        ['key', 'user_id', 'endpoint'],
        unique=True
    )


def downgrade() -> None:
    op.drop_index('ix_idempotency_key_user_endpoint', table_name='idempotency_keys')
    op.drop_table('idempotency_keys')
