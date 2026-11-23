from fastapi import HTTPException
from sqlalchemy import or_
from . import models


def validate_class_ids(db, user_id, class_ids, kind):
    ids = {value for value in class_ids if value is not None}
    if not ids:
        return
    available = db.query(models.ClassCatalog.id).filter(
        models.ClassCatalog.id.in_(ids),
        models.ClassCatalog.kind == kind,
        or_(models.ClassCatalog.owner_user_id == user_id, models.ClassCatalog.owner_user_id.is_(None)),
    ).all()
    if ids != {row[0] for row in available}:
        raise HTTPException(422, f"Select an accessible {kind} class or Без класса")
