import os
from sqlalchemy import create_engine, text

# Get config
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost/textologist_db")
DB_SCHEMA = os.getenv("DB_SCHEMA", "public")

if DB_SCHEMA == "public":
    print("Schema is 'public', skipping creation (usually exists).")
else:
    print(f"Connecting to {DATABASE_URL}...")
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as connection:
        # Create schema if not exists
        print(f"Creating schema '{DB_SCHEMA}' if not exists...")
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {DB_SCHEMA}"))
        connection.commit()
        print("Done.")
