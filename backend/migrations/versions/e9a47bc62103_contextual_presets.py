"""Contextual character and word preset rules, with reversible rule deletion."""
from alembic import op
import sqlalchemy as sa

revision = 'e9a47bc62103'
down_revision = 'c4e719ab032d'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('preset_rules', 'op_type', type_=sa.String(16),
                    postgresql_using='op_type::text', schema='collations')
    op.add_column('preset_rules', sa.Column('kind', sa.String(10), nullable=False, server_default='char'), schema='collations')
    op.add_column('preset_rules', sa.Column('base_word', sa.Text(), nullable=True), schema='collations')
    op.add_column('preset_rules', sa.Column('other_word', sa.Text(), nullable=True), schema='collations')
    op.add_column('preset_rules', sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false()), schema='collations')
    # Legacy rules deliberately retain NULL context: their original comparison
    # is not recorded, so reconstructing context from text IDs would be ambiguous.


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM collations.preset_rules WHERE kind='word' OR base_word IS NOT NULL OR other_word IS NOT NULL OR is_deleted)" )).scalar():
        raise RuntimeError('Cannot downgrade without losing contextual preset rules.')
    for column in ['is_deleted', 'other_word', 'base_word', 'kind']:
        op.drop_column('preset_rules', column, schema='collations')
    op.execute('ALTER TABLE collations.preset_rules ALTER COLUMN op_type TYPE optype USING op_type::optype')
