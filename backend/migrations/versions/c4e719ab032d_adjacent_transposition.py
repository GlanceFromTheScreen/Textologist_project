"""Persist adjacent transpositions and their reversible replacement snapshots."""
from alembic import op
import sqlalchemy as sa

revision = 'c4e719ab032d'
down_revision = 'b7d930e5a612'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE wordoptype ADD VALUE IF NOT EXISTS 'transpose'")
    op.add_column('comparison_word_ops', sa.Column('transpose_parts', sa.JSON(), nullable=True), schema='collations')
    op.add_column('comparisons', sa.Column('weight_transpose', sa.Float(), nullable=False, server_default='1'), schema='collations')


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM collations.comparison_word_ops WHERE op_type::text='transpose')")).scalar():
        raise RuntimeError('Split all transpositions before downgrading; never discard preserved operation data.')
    op.drop_column('comparison_word_ops', 'transpose_parts', schema='collations')
    op.drop_column('comparisons', 'weight_transpose', schema='collations')
    # PostgreSQL enum values cannot be removed in place; the unused value is harmless.
