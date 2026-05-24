from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Use environment variable or default to local postgres
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost/textologist_db")
DB_SCHEMA = os.getenv("DB_SCHEMA", "public") # Default to public

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Если схема не public, мы должны явно передать metadata с указанием schema
if DB_SCHEMA and DB_SCHEMA != "public":
    metadata_obj = MetaData(schema=DB_SCHEMA)
    Base = declarative_base(metadata=metadata_obj)
else:
    Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
