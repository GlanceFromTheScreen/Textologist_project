import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base

# Import models to ensure they are registered
from . import models

# In a real production setup, we might use alembic for all DDL, 
# but for MVP local dev without running migrations manually every time, 
# we can uncomment this to auto-create tables if they don't exist.
# Base.metadata.create_all(bind=engine)

app = FastAPI(title="Textologist", version="0.1.0")

# CORS setup
origins = [
    "http://localhost:3000",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to Textologist API"}

from .routers import auth, texts, fonts, comparisons, presets, stats, matrix, classes
app.include_router(auth.router)
app.include_router(texts.router)
app.include_router(fonts.router)
app.include_router(comparisons.router)
app.include_router(presets.router)
app.include_router(stats.router)
app.include_router(matrix.router)
app.include_router(classes.router)
