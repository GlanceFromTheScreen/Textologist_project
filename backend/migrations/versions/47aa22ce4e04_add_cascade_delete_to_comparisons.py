"""add_cascade_delete_to_comparisons

Revision ID: 47aa22ce4e04
Revises: 2bdb027e9822
Create Date: 2026-01-24 16:30:00.000000

"""
from alembic import op

revision = "47aa22ce4e04"
down_revision = "2bdb027e9822"
branch_labels = None
depends_on = None

SCHEMA = "collations"


def upgrade() -> None:
    op.drop_constraint(
        "comparison_word_ops_comparison_id_fkey",
        "comparison_word_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_word_ops_comparison_id_fkey",
        "comparison_word_ops",
        "comparisons",
        ["comparison_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "comparison_char_ops_comparison_id_fkey",
        "comparison_char_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_char_ops_comparison_id_fkey",
        "comparison_char_ops",
        "comparisons",
        ["comparison_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "comparison_char_ops_word_op_id_fkey",
        "comparison_char_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_char_ops_word_op_id_fkey",
        "comparison_char_ops",
        "comparison_word_ops",
        ["word_op_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "comparison_word_ops_comparison_id_fkey",
        "comparison_word_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_word_ops_comparison_id_fkey",
        "comparison_word_ops",
        "comparisons",
        ["comparison_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )

    op.drop_constraint(
        "comparison_char_ops_comparison_id_fkey",
        "comparison_char_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_char_ops_comparison_id_fkey",
        "comparison_char_ops",
        "comparisons",
        ["comparison_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )

    op.drop_constraint(
        "comparison_char_ops_word_op_id_fkey",
        "comparison_char_ops",
        type_="foreignkey",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "comparison_char_ops_word_op_id_fkey",
        "comparison_char_ops",
        "comparison_word_ops",
        ["word_op_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
