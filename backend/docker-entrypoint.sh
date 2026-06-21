#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."
until python -c "
import os, sys
sys.path.insert(0, '/app')
from sqlalchemy import create_engine, text
engine = create_engine(os.environ['DATABASE_URL'])
with engine.connect() as conn:
    conn.execute(text('SELECT 1'))
" 2>/dev/null; do
  sleep 2
done
echo "PostgreSQL is ready."

python backend/create_schema.py
cd backend && alembic upgrade head
cd /app

exec uvicorn backend.main:app --host 0.0.0.0 --port 8000
