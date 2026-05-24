"""add_levenshtein_v2_to_enum

Revision ID: a1b2c3d4e5f6
Revises: 6115a5fc214b
Create Date: 2026-04-22 12:00:00.000000

"""
from alembic import op

from backend.database import DB_SCHEMA


revision = "a1b2c3d4e5f6"
down_revision = "6115a5fc214b"
branch_labels = None
depends_on = None


def _comparison_algorithm_type_sql() -> str:
    """Enum type created in the app schema (see 2bdb027e9822_initial comparisons.algorithm)."""
    if DB_SCHEMA and DB_SCHEMA != "public":
        return f'"{DB_SCHEMA}".comparisonalgorithm'
    return "comparisonalgorithm"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            f"ALTER TYPE {_comparison_algorithm_type_sql()} ADD VALUE 'levenshtein_v2'"
        )


def downgrade() -> None:
    pass
