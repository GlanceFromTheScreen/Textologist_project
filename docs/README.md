# Textologist: Разночтения

Web application for text comparison and analysis.

## Project Structure

- `backend/`: FastAPI application.
- `frontend/`: Next.js application.
- `algo/`: Isolated algorithm module (tokenization, diff, etc.).

## Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL (optional for local dev, defaults to SQLite if not configured or easily switchable, currently configured for Postgres/SQLite via SQLAlchemy)

## Setup and Run

### 1. Backend

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies (including local algo module)
pip install -r backend/requirements.txt

# Run Migrations (if using a real DB, or let SQLAlchemy create tables in dev)
# For MVP, tables are auto-created in main.py if you uncomment the line, 
# or run alembic:
cd backend
alembic upgrade head
export DATABASE_URL="postgresql:..."
export DB_SCHEMA="collations"
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
kill -9 $(lsof -ti:3000)
pkill -f uvicorn        


# Run Server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Documentation

Once the backend is running, visit:
http://localhost:8000/docs

## Features Implemented (Backend)

- Auth (Register/Login)
- Text Upload (.docx/.txt)
- Font Upload (.ttf/.otf/.woff)
- Comparisons (Word-level diff + Char-level atomic ops)
- Stats
- Presets & Rules
- Distance Matrix
- Class Management
