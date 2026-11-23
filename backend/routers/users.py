"""Administrator-only account creation and credential management."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .. import dependencies, models, schemas, utils

router = APIRouter(prefix='/users', tags=['users'])


def commit_account(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Этот логин уже занят')


@router.get('/', response_model=List[schemas.User])
def list_users(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000),
               current_user: models.User = Depends(dependencies.get_current_admin),
               db: Session = Depends(dependencies.get_db)):
    return db.query(models.User).order_by(models.User.id).offset(skip).limit(limit).all()


@router.post('/', response_model=schemas.User, status_code=201)
def create_user(data: schemas.AdminUserCreate,
                current_user: models.User = Depends(dependencies.get_current_admin),
                db: Session = Depends(dependencies.get_db)):
    if db.query(models.User.id).filter_by(username=data.username).first():
        raise HTTPException(409, 'Этот логин уже занят')
    user = models.User(username=data.username, password_hash=utils.get_password_hash(data.password), role=models.UserRole.user)
    db.add(user)
    commit_account(db)
    db.refresh(user)
    return user


@router.patch('/{user_id}', response_model=schemas.User)
def update_user(user_id: int, data: schemas.AdminUserUpdate,
                current_user: models.User = Depends(dependencies.get_current_admin),
                db: Session = Depends(dependencies.get_db)):
    user = db.query(models.User).filter_by(id=user_id).with_for_update().first()
    if user is None:
        raise HTTPException(404, 'Пользователь не найден')
    if data.username is not None and db.query(models.User.id).filter(models.User.username == data.username, models.User.id != user_id).first():
        raise HTTPException(409, 'Этот логин уже занят')
    changed = False
    if data.username is not None and data.username != user.username:
        user.username = data.username
        changed = True
    if data.password is not None:
        user.password_hash = utils.get_password_hash(data.password)
        changed = True
    if changed:
        user.auth_version += 1
    commit_account(db)
    db.refresh(user)
    return user
