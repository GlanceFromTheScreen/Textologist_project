from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, distinct
from typing import List, Dict
from .. import schemas, models, dependencies
import collections

router = APIRouter(
    prefix="/comparisons",
    tags=["stats"],
)

@router.get("/{comp_id}/stats", response_model=schemas.ComparisonStats)
def get_comparison_stats(
    comp_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    # Totals
    total_replace = db.query(models.ComparisonWordOp).filter(models.ComparisonWordOp.comparison_id == comp_id, models.ComparisonWordOp.op_type == models.WordOpType.replace).count()
    total_insert = db.query(models.ComparisonWordOp).filter(models.ComparisonWordOp.comparison_id == comp_id, models.ComparisonWordOp.op_type == models.WordOpType.insert).count()
    total_delete = db.query(models.ComparisonWordOp).filter(models.ComparisonWordOp.comparison_id == comp_id, models.ComparisonWordOp.op_type == models.WordOpType.delete).count()
    
    total_transpose = db.query(models.ComparisonWordOp).filter_by(comparison_id=comp_id, op_type=models.WordOpType.transpose).count()
    totals = schemas.StatsTotals(transpose=total_transpose, replace=total_replace, insert=total_insert, delete=total_delete)
    
    # Top Word Replacements
    top_words_q = db.query(
        models.ComparisonWordOp.base_token,
        models.ComparisonWordOp.other_token,
        func.count(models.ComparisonWordOp.id).label('count')
    ).filter(
        models.ComparisonWordOp.comparison_id == comp_id,
        models.ComparisonWordOp.op_type == models.WordOpType.replace
    ).group_by(
        models.ComparisonWordOp.base_token,
        models.ComparisonWordOp.other_token
    ).order_by(desc('count')).limit(10).all()
    
    top_words = [schemas.TopWordReplacement(from_token=w[0], to_token=w[1], count=w[2]) for w in top_words_q]
    
    # Calculate character frequencies in base text
    # Fetch all base tokens for this comparison to calculate total char occurrences
    # We need to consider all tokens that came from base text: equal, replace, delete
    # Ignore 'insert' as they are from other text
    base_tokens_q = db.query(models.ComparisonWordOp.base_token).filter(
        models.ComparisonWordOp.comparison_id == comp_id,
        models.ComparisonWordOp.op_type.in_([models.WordOpType.equal, models.WordOpType.replace, models.WordOpType.delete, models.WordOpType.transpose])
    ).all()
    
    char_counts: Dict[str, int] = collections.defaultdict(int)
    for row in base_tokens_q:
        token = row[0]
        if token:
            for char in token:
                char_counts[char] += 1
    
    # Top Char Ops
    top_char_q = db.query(
        models.ComparisonCharOp.op_type,
        models.ComparisonCharOp.from_str,
        models.ComparisonCharOp.to_str,
        func.count(models.ComparisonCharOp.id).label('count'),
        func.count(distinct(models.ComparisonWordOp.base_token)).label("unique_contexts")
    ).join(
        models.ComparisonWordOp, models.ComparisonCharOp.word_op_id == models.ComparisonWordOp.id
    ).filter(
        models.ComparisonCharOp.comparison_id == comp_id
    ).group_by(
        models.ComparisonCharOp.op_type,
        models.ComparisonCharOp.from_str,
        models.ComparisonCharOp.to_str
    ).order_by(desc('count')).all() # Get all to filter/limit later if needed, but usually list is small
    
    top_chars = []
    for c in top_char_q:
        op_type = c[0]
        from_char = c[1]
        count = c[3]
        
        freq = 0.0
        # Frequency = count / total occurrences of from_char in base text
        # Only applicable if from_char exists (for insert, from_char is empty)
        
        if op_type == models.OpType.insert:
             # For insertion, what is the denominator? 
             # Usually "insertion rate" is relative to text length or something else.
             # But spec implies "left symbol". For insert left symbol is empty.
             # Let's keep 0.0 or maybe relative to total characters? 
             # Standard error rate logic: inserts / total_chars.
             total_chars_count = sum(char_counts.values())
             if total_chars_count > 0:
                 freq = count / total_chars_count
        else:
            # Change or Delete
            if from_char in char_counts and char_counts[from_char] > 0:
                freq = count / char_counts[from_char]
        
        top_chars.append(schemas.TopCharOp(
            op_type=c[0], 
            from_str=c[1], 
            to_str=c[2], 
            count=c[3],
            unique_contexts=c[4],
            frequency=freq
        ))
        
    # Limit to top 10 after calculation
    top_chars = sorted(top_chars, key=lambda x: x.count, reverse=True)[:10]
    
    # Class Distribution
    dist_q = db.query(
        models.ComparisonCharOp.class_id,
        models.ClassCatalog.display_name,
        models.ClassCatalog.color_hex,
        func.count(models.ComparisonCharOp.id).label('count')
    ).outerjoin(
        models.ClassCatalog, models.ComparisonCharOp.class_id == models.ClassCatalog.id
    ).filter(
        models.ComparisonCharOp.comparison_id == comp_id
    ).group_by(
        models.ComparisonCharOp.class_id,
        models.ClassCatalog.display_name,
        models.ClassCatalog.color_hex
    ).all()
    
    class_dist = []
    for d in dist_q:
        class_dist.append(schemas.ClassDistributionItem(
            class_id=d[0],
            display_name=d[1] if d[1] else "Unclassified",
            color_hex=d[2] if d[2] else "#cccccc",
            count=d[3]
        ))
        
    return schemas.ComparisonStats(
        totals=totals,
        top_word_replacements=top_words,
        top_char_ops=top_chars,
        class_distribution=class_dist
    )
