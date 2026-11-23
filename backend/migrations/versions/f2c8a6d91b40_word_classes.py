"""Separate word and character classes and classify word operations."""
from alembic import op
import sqlalchemy as sa

revision = "f2c8a6d91b40"
down_revision = "d7c2e9a4b601"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("class_catalog", sa.Column("kind", sa.String(10), nullable=False, server_default="char"), schema="collations")
    op.create_check_constraint("ck_class_catalog_kind", "class_catalog", "kind IN ('word', 'char')", schema="collations")
    op.add_column("comparison_word_ops", sa.Column("class_id", sa.Integer(), nullable=True), schema="collations")
    op.create_foreign_key("fk_word_op_class", "comparison_word_ops", "class_catalog", ["class_id"], ["id"], source_schema="collations", referent_schema="collations")


def downgrade():
    op.drop_constraint("fk_word_op_class", "comparison_word_ops", type_="foreignkey", schema="collations")
    op.drop_column("comparison_word_ops", "class_id", schema="collations")
    op.drop_constraint("ck_class_catalog_kind", "class_catalog", type_="check", schema="collations")
    op.drop_column("class_catalog", "kind", schema="collations")
