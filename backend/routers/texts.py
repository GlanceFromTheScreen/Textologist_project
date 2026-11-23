from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
import os
import shutil
import uuid
from .. import schemas, models, dependencies, utils_text

router = APIRouter(
    prefix="/texts",
    tags=["texts"],
)

UPLOAD_DIR = "uploads/texts"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload", response_model=schemas.Text)
async def upload_text(
    title: str = Form(...),
    file: UploadFile = File(...),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    # Validate file extension
    filename = file.filename
    ext = filename.split('.')[-1].lower()
    if ext not in ["txt", "docx"]:
        raise HTTPException(status_code=400, detail="Only .txt and .docx files are allowed")
    
    source_type = models.SourceType.docx if ext == "docx" else models.SourceType.txt

    # Create user directory
    user_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)
    
    # Generate unique filename to avoid collisions
    unique_filename = f"{uuid.uuid4()}.{ext}"
    file_path = os.path.join(user_dir, unique_filename)
    
    # Read file content
    content = await file.read()
    
    # Save to disk
    with open(file_path, "wb") as buffer:
        buffer.write(content)
        
    # Extract paragraphs
    try:
        if source_type == models.SourceType.docx:
            paragraphs = utils_text.extract_paragraphs_docx(content)
        else:
            paragraphs = utils_text.extract_paragraphs_txt(content)
    except Exception as e:
        # Cleanup file if extraction fails
        os.remove(file_path)
        raise HTTPException(status_code=400, detail=f"Error extracting text: {str(e)}")

    # Save to DB
    db_text = models.TextModel(
        owner_user_id=current_user.id,
        title=title,
        source_type=source_type,
        file_path=file_path,
        extracted_paragraphs_json=paragraphs
    )
    db.add(db_text)
    db.commit()
    db.refresh(db_text)
    return db_text

@router.get("/", response_model=List[schemas.TextSummary])
def read_texts(
    skip: int = 0, 
    limit: int = 100, 
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    texts = db.query(models.TextModel).filter(models.TextModel.owner_user_id == current_user.id).offset(skip).limit(limit).all()
    return texts

@router.get("/{text_id}", response_model=schemas.Text)
def read_text(
    text_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    text = db.query(models.TextModel).filter(models.TextModel.id == text_id, models.TextModel.owner_user_id == current_user.id).first()
    if text is None:
        raise HTTPException(status_code=404, detail="Text not found")
    return text

@router.patch("/{text_id}", response_model=schemas.TextSummary)
def rename_text(
    text_id: int,
    request: schemas.TextRenameRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    text = db.query(models.TextModel).filter(
        models.TextModel.id == text_id,
        models.TextModel.owner_user_id == current_user.id,
    ).first()
    if text is None:
        raise HTTPException(404, "Text not found")
    text.title = request.title
    db.commit()
    db.refresh(text)
    return text


@router.delete("/{text_id}")
def delete_text(
    text_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    text = db.query(models.TextModel).filter(models.TextModel.id == text_id, models.TextModel.owner_user_id == current_user.id).first()
    if text is None:
        raise HTTPException(status_code=404, detail="Text not found")
    
    # Delete file from disk
    if os.path.exists(text.file_path):
        os.remove(text.file_path)
        
    db.delete(text)
    db.commit()
    return {"ok": True}
