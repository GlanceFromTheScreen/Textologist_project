"""Add the mandatory word class for insignificant changes."""
from alembic import op
import sqlalchemy as sa

revision = "b7d930e5a612"
down_revision = "f2c8a6d91b40"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("class_catalog", sa.Column("system_key", sa.String(40), nullable=True), schema="collations")
    op.create_unique_constraint("uq_class_catalog_system_key", "class_catalog", ["system_key"], schema="collations")
    op.create_check_constraint("ck_class_catalog_system", "class_catalog", "system_key IS NULL OR (system_key = 'insignificant' AND kind = 'word' AND owner_user_id IS NULL)", schema="collations")
    op.execute(sa.text("INSERT INTO collations.class_catalog (owner_user_id, code, display_name, color_hex, kind, system_key) VALUES (NULL, 'system:insignificant', 'Несущественные изменения', '#64748b', 'word', 'insignificant')"))


def downgrade():
    # Keep the catalog entry and all assignments; an older version treats it as an ordinary class.
    op.drop_constraint("ck_class_catalog_system", "class_catalog", type_="check", schema="collations")
    op.drop_constraint("uq_class_catalog_system_key", "class_catalog", type_="unique", schema="collations")
    op.drop_column("class_catalog", "system_key", schema="collations")
