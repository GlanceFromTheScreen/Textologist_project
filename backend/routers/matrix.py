from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import algo
from .. import schemas, models, dependencies

router = APIRouter(
    prefix="/distance-matrix",
    tags=["matrix"],
)

@router.post("/run", response_model=schemas.DistanceMatrixResponse)
def run_matrix(
    request: schemas.DistanceMatrixRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    if len(request.text_ids) > 20:
        raise HTTPException(status_code=400, detail="Max 20 texts allowed")
        
    # Fetch texts
    texts = db.query(models.TextModel).filter(
        models.TextModel.id.in_(request.text_ids),
        models.TextModel.owner_user_id == current_user.id
    ).all()
    
    # Sort texts to match order in request? Or just return labels in order.
    # Map id -> text
    text_map = {t.id: t for t in texts}
    ordered_texts = []
    for tid in request.text_ids:
        if tid in text_map:
            ordered_texts.append(text_map[tid])
        # If not found, skip or error? Spec says "multiselect texts".
    
    if not ordered_texts:
        return schemas.DistanceMatrixResponse(labels=[], matrix=[])

    # Tokenize all (cache)
    tokenized_texts = []
    for t in ordered_texts:
        res = algo.tokenize_paragraphs(t.extracted_paragraphs_json)
        tokenized_texts.append(res.tokens)
        
    weights = algo.Weights(
        replace=request.weights.replace,
        delete=request.weights.delete,
        insert=request.weights.insert,
        char_replace=request.weights.char_replace,
        char_delete=request.weights.char_delete,
        char_insert=request.weights.char_insert,
    )
    
    n = len(ordered_texts)
    matrix = [[0.0] * n for _ in range(n)]
    
    for i in range(n):
        for j in range(n):
            if i == j:
                matrix[i][j] = 0.0
            else:
                # distance(base, other) -> transform i to j
                dist = algo.distance(tokenized_texts[i], tokenized_texts[j], weights, algorithm=request.algorithm.value)
                matrix[i][j] = dist
                
    labels = [t.title for t in ordered_texts]
    
    return schemas.DistanceMatrixResponse(labels=labels, matrix=matrix)
