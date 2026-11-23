"""Allow imported comparisons without source texts and add comparison titles."""
from alembic import op
import sqlalchemy as sa

revision = "d7c2e9a4b601"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("comparisons", sa.Column("title", sa.String(200), nullable=True), schema="collations")
    for column in ("base_text_id", "other_text_id"):
        op.alter_column("comparisons", column, existing_type=sa.Integer(), nullable=True, schema="collations")


def downgrade():
    # PostgreSQL rejects this downgrade while imported comparisons exist;
    # never delete users' imported data to make an older schema fit.
    for column in ("base_text_id", "other_text_id"):
        op.alter_column("comparisons", column, existing_type=sa.Integer(), nullable=False, schema="collations")
    op.drop_column("comparisons", "title", schema="collations")
