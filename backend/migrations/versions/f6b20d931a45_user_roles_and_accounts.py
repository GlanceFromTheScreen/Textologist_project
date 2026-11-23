"""User/admin roles, stable starter-account identity, revocable login sessions."""
from alembic import op
import sqlalchemy as sa

revision = 'f6b20d931a45'
down_revision = 'e9a47bc62103'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE userrole RENAME VALUE 'textologist' TO 'user'")
    op.execute("UPDATE collations.users SET role = CASE WHEN username = 'admin' THEN 'admin'::userrole ELSE 'user'::userrole END")
    op.alter_column('users', 'role', nullable=False, server_default='user', schema='collations')
    op.add_column('users', sa.Column('auth_version', sa.Integer(), nullable=False, server_default='0'), schema='collations')
    op.add_column('users', sa.Column('bootstrap_key', sa.String(120), nullable=True), schema='collations')
    op.create_unique_constraint('uq_users_bootstrap_key', 'users', ['bootstrap_key'], schema='collations')
    op.execute("UPDATE collations.users SET bootstrap_key = username WHERE username IN ('admin','user1','user2')")


def downgrade():
    op.drop_constraint('uq_users_bootstrap_key', 'users', type_='unique', schema='collations')
    op.drop_column('users', 'bootstrap_key', schema='collations')
    op.drop_column('users', 'auth_version', schema='collations')
    op.alter_column('users', 'role', nullable=True, server_default=None, schema='collations')
    op.execute("ALTER TYPE userrole RENAME VALUE 'user' TO 'textologist'")
