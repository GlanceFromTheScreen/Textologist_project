"""Allow persisting the Myers algorithm already exposed in the UI."""
from alembic import op

revision = 'b3d62fa0918c'
down_revision = 'a8b491ce62d0'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE comparisonalgorithm ADD VALUE IF NOT EXISTS 'myers'")


def downgrade():
    # PostgreSQL cannot safely remove a value used by existing comparisons.
    pass
