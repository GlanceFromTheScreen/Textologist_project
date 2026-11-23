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

def owned_rule(db, user_id, preset_id, rule_id):
    rule = db.query(models.PresetRule).join(models.Preset).filter(
        models.Preset.owner_user_id == user_id,
        models.PresetRule.preset_id == preset_id,
        models.PresetRule.id == rule_id,
    ).first()
    if not rule:
        raise HTTPException(404, "Preset rule not found")
    return rule


@router.delete("/{preset_id}/rules/{rule_id}", response_model=schemas.PresetRuleRead)
def delete_rule(preset_id: int, rule_id: int,
                current_user: models.User = Depends(dependencies.get_current_active_user),
                db: Session = Depends(dependencies.get_db)):
    rule = owned_rule(db, current_user.id, preset_id, rule_id)
    rule.is_deleted = True
    db.commit()
    db.refresh(rule)
    return rule


@router.post("/{preset_id}/rules/{rule_id}/restore", response_model=schemas.PresetRuleRead)
def restore_rule(preset_id: int, rule_id: int,
                 current_user: models.User = Depends(dependencies.get_current_active_user),
                 db: Session = Depends(dependencies.get_db)):
    rule = owned_rule(db, current_user.id, preset_id, rule_id)
    rule.is_deleted = False
    db.commit()
    db.refresh(rule)
    return rule
