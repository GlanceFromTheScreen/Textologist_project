from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Import my models
import os
import sys

# Calculate path to project root
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))

# Add project root to sys.path
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Import as package to resolve relative imports in models.py
try:
    from backend.database import Base, DATABASE_URL, DB_SCHEMA
    import backend.models  # This ensures all models are registered with Base
except ImportError:
    print(f"Project root added to path: {project_root}")
    print(f"Current sys.path: {sys.path}")
    raise

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

config.set_main_option("sqlalchemy.url", DATABASE_URL)

def include_name(name, type_, parent_names):
    if type_ == "schema":
        # Only allow our target schema
        # Note: None usually means default schema (public in postgres usually)
        if name is None:
             return DB_SCHEMA == "public"
        return name == DB_SCHEMA
    return True

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_name=include_name
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, 
            target_metadata=target_metadata,
            include_schemas=True,
            include_name=include_name
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
