"""Add sale_returns tables and update sale_items

Revision ID: 20260131_2324_add_sale_returns
Revises: 20260131_2315_add_idempotency_keys
Create Date: 2026-01-31 23:24:00
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260131_2324'
down_revision = '20260131_2315'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add quantity_returned column to sale_items
    op.add_column('sale_items', sa.Column('quantity_returned', sa.Integer(), nullable=False, server_default='0'))
    
    # Update SaleStatus enum to include new values
    # For PostgreSQL, we need to add new values to the enum
    op.execute("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'partially_returned'")
    op.execute("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'returned'")
    
    # Create sale_returns table
    op.create_table(
        'sale_returns',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('sale_id', sa.Integer(), sa.ForeignKey('sales.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('total_refund_amount', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('refund_method', sa.Enum('cash', 'card', 'mobile', name='paymentmethod', create_type=False), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )
    
    # Create sale_return_items table
    op.create_table(
        'sale_return_items',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('sale_return_id', sa.Integer(), sa.ForeignKey('sale_returns.id'), nullable=False),
        sa.Column('sale_item_id', sa.Integer(), sa.ForeignKey('sale_items.id'), nullable=False),
        sa.Column('quantity_returned', sa.Integer(), nullable=False),
        sa.Column('refund_amount', sa.Numeric(12, 2), nullable=False),
    )
    
    # Create indexes
    op.create_index('ix_sale_returns_sale_id', 'sale_returns', ['sale_id'])
    op.create_index('ix_sale_return_items_sale_return_id', 'sale_return_items', ['sale_return_id'])


def downgrade() -> None:
    op.drop_index('ix_sale_return_items_sale_return_id', table_name='sale_return_items')
    op.drop_index('ix_sale_returns_sale_id', table_name='sale_returns')
    op.drop_table('sale_return_items')
    op.drop_table('sale_returns')
    op.drop_column('sale_items', 'quantity_returned')
    # Note: Cannot easily remove enum values in PostgreSQL
