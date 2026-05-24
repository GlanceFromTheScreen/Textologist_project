from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from .. import schemas, models, dependencies

router = APIRouter(
    prefix="/presets",
    tags=["presets"],
)

@router.post("/", response_model=schemas.PresetRead)
def create_preset(
    preset: schemas.PresetCreate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    db_preset = models.Preset(
        owner_user_id=current_user.id,
        name=preset.name,
        description=preset.description
    )
    db.add(db_preset)
    db.commit()
    db.refresh(db_preset)
    return db_preset

@router.get("/", response_model=List[schemas.PresetRead])
def read_presets(
    skip: int = 0, 
    limit: int = 100, 
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    presets = db.query(models.Preset).filter(models.Preset.owner_user_id == current_user.id).offset(skip).limit(limit).all()
    return presets

@router.get("/{preset_id}", response_model=schemas.PresetRead)
def read_preset(
    preset_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    preset = db.query(models.Preset).filter(models.Preset.id == preset_id, models.Preset.owner_user_id == current_user.id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    return preset

@router.delete("/{preset_id}")
def delete_preset(
    preset_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    preset = db.query(models.Preset).filter(models.Preset.id == preset_id, models.Preset.owner_user_id == current_user.id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    db.delete(preset)
    db.commit()
    return {"ok": True}

# Save as preset logic (needs to be here or in comparisons router? Spec says POST /comparisons/{id}/save-as-preset. 
# It fits better in comparisons router logically, but returns a preset. 
# I will put it in comparisons router to keep prefix consistent with spec)

# Helper function for conflict resolution
def resolve_conflict(rules_group):
    # rules_group is list of {class_id, class_name}
    # 1. Filter out nulls if possible
    non_nulls = [r for r in rules_group if r['class_id'] is not None]
    if not non_nulls:
        return None # All null
    
    if len(non_nulls) == 1:
        return non_nulls[0]['class_id']
    
    # 2. Sort by class display_name
    # We need to join with ClassCatalog to get display_name.
    # Assuming the input has class_name populated.
    non_nulls.sort(key=lambda x: x['class_name'] or "")
    return non_nulls[0]['class_id']
