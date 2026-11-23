"""Persist explicit token separators for comparisons."""
from alembic import op
import sqlalchemy as sa

revision = 'a8b491ce62d0'
down_revision = 'f6b20d931a45'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('comparisons', sa.Column('separators', sa.JSON(), nullable=False, server_default='[" "]'), schema='collations')


def downgrade():
    op.drop_column('comparisons', 'separators', schema='collations')
