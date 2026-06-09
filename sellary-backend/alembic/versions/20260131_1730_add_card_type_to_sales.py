"""add card_type column to sales

Revision ID: 20260131_1730
Revises: 370dc0c40137
Create Date: 2026-01-31 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260131_1730'
down_revision: Union[str, None] = '370dc0c40137'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the cardtype enum type
    card_type_enum = sa.Enum('alif', 'eskhata', 'dc', name='cardtype')
    card_type_enum.create(op.get_bind(), checkfirst=True)
    
    # Add card_type column to sales table
    op.add_column('sales', sa.Column('card_type', sa.Enum('alif', 'eskhata', 'dc', name='cardtype'), nullable=True))


def downgrade() -> None:
    # Remove card_type column
    op.drop_column('sales', 'card_type')
    
    # Drop the cardtype enum type
    sa.Enum(name='cardtype').drop(op.get_bind(), checkfirst=True)
