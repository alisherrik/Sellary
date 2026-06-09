"""Add restaurant support: context_type, product_type, and table_name

Revision ID: 20260201_0000
Revises: 20260131_2324
Create Date: 2026-02-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260201_0000'
down_revision = '20260131_2324'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create the salecontexttype enum type
    sale_context_type_enum = sa.Enum('retail', 'restaurant', name='salecontexttype')
    sale_context_type_enum.create(op.get_bind(), checkfirst=True)

    # Add context_type column to sales table with default 'retail'
    op.add_column(
        'sales',
        sa.Column(
            'context_type',
            sa.Enum('retail', 'restaurant', name='salecontexttype'),
            nullable=False,
            server_default='retail'
        )
    )

    # Add index on context_type for efficient filtering
    op.create_index('ix_sales_context_type', 'sales', ['context_type'])

    # Add table_name column to sales table (nullable, for restaurant orders)
    op.add_column(
        'sales',
        sa.Column('table_name', sa.String(50), nullable=True)
    )

    # Create the producttype enum type
    product_type_enum = sa.Enum('item', 'dish', name='producttype')
    product_type_enum.create(op.get_bind(), checkfirst=True)

    # Add product_type column to products table with default 'item'
    op.add_column(
        'products',
        sa.Column(
            'product_type',
            sa.Enum('item', 'dish', name='producttype'),
            nullable=False,
            server_default='item'
        )
    )

    # Make barcode column nullable in products table (dishes don't require barcode)
    op.alter_column(
        'products',
        'barcode',
        existing_type=sa.String(50),
        nullable=True
    )


def downgrade() -> None:
    # Remove product_type column
    op.drop_column('products', 'product_type')

    # Drop the producttype enum type
    sa.Enum(name='producttype').drop(op.get_bind(), checkfirst=True)

    # Make barcode column NOT NULL again
    op.alter_column(
        'products',
        'barcode',
        existing_type=sa.String(50),
        nullable=False
    )

    # Remove table_name column
    op.drop_column('sales', 'table_name')

    # Remove index on context_type
    op.drop_index('ix_sales_context_type', table_name='sales')

    # Remove context_type column
    op.drop_column('sales', 'context_type')

    # Drop the salecontexttype enum type
    sa.Enum(name='salecontexttype').drop(op.get_bind(), checkfirst=True)
