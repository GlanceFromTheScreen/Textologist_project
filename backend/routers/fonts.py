from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
import uuid
from .. import schemas, models, dependencies

router = APIRouter(
    prefix="/fonts",
    tags=["fonts"],
)

UPLOAD_DIR = "uploads/fonts"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload", response_model=schemas.Font)
async def upload_font(
    name: str = Form(...),
    file: UploadFile = File(...),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    # Validate file extension
    filename = file.filename
    ext = filename.split('.')[-1].lower()
    if ext not in ["ttf", "otf", "woff"]:
        raise HTTPException(status_code=400, detail="Only .ttf, .otf, .woff files are allowed")
    
    font_format = models.FontFormat(ext)

    # Create user directory
    user_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)
    
    # Generate unique filename
    unique_filename = f"{uuid.uuid4()}.{ext}"
    file_path = os.path.join(user_dir, unique_filename)
    
    # Save to disk
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Save to DB
    db_font = models.Font(
        owner_user_id=current_user.id,
        name=name,
        format=font_format,
        file_path=file_path
    )
    db.add(db_font)
    db.commit()
    db.refresh(db_font)
    return db_font

@router.get("/", response_model=List[schemas.Font])
def read_fonts(
    skip: int = 0, 
    limit: int = 100, 
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    fonts = db.query(models.Font).filter(models.Font.owner_user_id == current_user.id).offset(skip).limit(limit).all()
    return fonts

@router.get("/{font_id}/file")
def get_font_file(
    font_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    font = db.query(models.Font).filter(models.Font.id == font_id, models.Font.owner_user_id == current_user.id).first()
    if font is None:
        raise HTTPException(status_code=404, detail="Font not found")
    
    if not os.path.exists(font.file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
        
    return FileResponse(font.file_path, media_type=f"font/{font.format.value}", filename=f"{font.name}.{font.format.value}")

@router.delete("/{font_id}")
def delete_font(
    font_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    font = db.query(models.Font).filter(models.Font.id == font_id, models.Font.owner_user_id == current_user.id).first()
    if font is None:
        raise HTTPException(status_code=404, detail="Font not found")
    
    # Delete file from disk
    if os.path.exists(font.file_path):
        os.remove(font.file_path)
        
    db.delete(font)
    db.commit()
    return {"ok": True}
