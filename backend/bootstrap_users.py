"""Create missing starter accounts; preserve administrator-managed credentials."""
import os
from sqlalchemy import select, text
from . import models, utils

DEFAULT_USERS = (
    ('admin', 'BOOTSTRAP_ADMIN_PASSWORD', models.UserRole.admin),
    ('user1', 'BOOTSTRAP_USER1_PASSWORD', models.UserRole.user),
    ('user2', 'BOOTSTRAP_USER2_PASSWORD', models.UserRole.user),
)


def configured_default_users():
    """Seed admin by default; optional users still require configured passwords."""
    accounts = []
    for name, variable, role in DEFAULT_USERS:
        password = os.environ.get(variable, "")
        if not password and variable == 'BOOTSTRAP_ADMIN_PASSWORD':
            password = 'admin'
        if password:
            accounts.append((name, password, role))
    return tuple(accounts)


def ensure_default_users(db, accounts=None):
    if accounts is None:
        accounts = configured_default_users()
    # Serialize startup workers so the same account cannot be seeded twice.
    db.execute(text('SELECT pg_advisory_xact_lock(72410938)'))
    for key, password, role in accounts:
        user = db.scalar(select(models.User).where(models.User.bootstrap_key == key))
        if user is not None:
            continue
        user = db.scalar(select(models.User).where(models.User.username == key))
        if user is None:
            user = models.User(username=key, password_hash=utils.get_password_hash(password), role=role)
            db.add(user)
        user.bootstrap_key = key
    db.commit()
