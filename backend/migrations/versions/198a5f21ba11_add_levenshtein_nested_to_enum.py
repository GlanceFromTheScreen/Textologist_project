"""add_levenshtein_nested_to_enum

Revision ID: 198a5f21ba11
Revises: 47aa22ce4e04
Create Date: 2026-01-24 16:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '198a5f21ba11'
down_revision = '47aa22ce4e04'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres specific command to add value to enum
    # We must run this outside of a transaction block because ALTER TYPE ... ADD VALUE cannot run inside a transaction block 
    # unless it's created in the same transaction (which is not the case here).
    # So we use op.execute with execution_options
    
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE comparisonalgorithm ADD VALUE IF NOT EXISTS 'levenshtein_nested'")


def downgrade() -> None:
    # Removing value from ENUM is not supported directly in Postgres without dropping and recreating the type.
    # For now, we can skip downgrade or implement full type recreation if strictly necessary.
    pass
