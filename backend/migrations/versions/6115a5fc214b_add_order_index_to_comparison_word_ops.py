"""Add order_index to comparison_word_ops

Revision ID: 6115a5fc214b
Revises: 198a5f21ba11
Create Date: 2026-03-15 14:53:24.408566

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6115a5fc214b'
down_revision: Union[str, None] = '198a5f21ba11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('comparison_word_ops', sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('comparison_word_ops', 'order_index')
