from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, distinct
from typing import Annotated, Dict, Literal
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
    db: Session = Depends(dependencies.get_db),
    significance: Literal["all", "insignificant", "significant"] = "all",
    page: Annotated[int, Query(ge=1)] = 1,
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    word_filters = [models.ComparisonWordOp.comparison_id == comp_id]
    insignificant = models.ComparisonWordOp.word_class.has(
        models.ClassCatalog.system_key == "insignificant"
    )
    if significance == "insignificant":
        word_filters.append(insignificant)
    elif significance == "significant":
        # NOT EXISTS also includes changes without an assigned word class.
        word_filters.append(~insignificant)

    # Overview always includes both categories, independently of the chart/table filter.
    kinds = ("replace", "insert", "delete", "transpose")
    all_counts = dict.fromkeys(kinds, 0)
    hidden_counts = dict.fromkeys(kinds, 0)
    total_rows = db.query(
        models.ComparisonWordOp.op_type, models.ClassCatalog.system_key,
        func.count(models.ComparisonWordOp.id)
    ).outerjoin(models.ClassCatalog, models.ComparisonWordOp.class_id == models.ClassCatalog.id
    ).filter(models.ComparisonWordOp.comparison_id == comp_id
    ).group_by(models.ComparisonWordOp.op_type, models.ClassCatalog.system_key).all()
    for kind, system_key, count in total_rows:
        if kind.value not in kinds:
            continue
        all_counts[kind.value] += count
        if system_key == "insignificant":
            hidden_counts[kind.value] += count
    breakdown = schemas.StatsSignificanceTotals(
        all=schemas.StatsTotals(**all_counts),
        insignificant=schemas.StatsTotals(**hidden_counts),
        significant=schemas.StatsTotals(**{key: all_counts[key] - hidden_counts[key] for key in kinds}),
    )
    totals = getattr(breakdown, significance)

    # Top Word Replacements
    top_words_q = db.query(
        models.ComparisonWordOp.base_token,
        models.ComparisonWordOp.other_token,
        func.count(models.ComparisonWordOp.id).label('count')
    ).filter(
        *word_filters,
        models.ComparisonWordOp.op_type == models.WordOpType.replace
    ).group_by(
        models.ComparisonWordOp.base_token,
        models.ComparisonWordOp.other_token
    ).order_by(desc('count')).limit(10).all()
    
    top_words = [schemas.TopWordReplacement(from_token=w[0], to_token=w[1], count=w[2]) for w in top_words_q]
    
    # Count each word operation once, including a transposition pair. Unchanged
    # words and the character snapshots inside a transposition are not changes.
    changed_filters = [*word_filters, models.ComparisonWordOp.op_type != models.WordOpType.equal]
    word_dist_rows = db.query(
        models.ComparisonWordOp.class_id, models.ClassCatalog.display_name,
        models.ClassCatalog.color_hex, func.count(models.ComparisonWordOp.id).label('count')
    ).outerjoin(models.ClassCatalog, models.ComparisonWordOp.class_id == models.ClassCatalog.id
    ).filter(*changed_filters).group_by(
        models.ComparisonWordOp.class_id, models.ClassCatalog.display_name, models.ClassCatalog.color_hex
    ).order_by(desc('count'), models.ComparisonWordOp.class_id.asc().nullsfirst()).all()
    word_class_dist = [schemas.ClassDistributionItem(
        class_id=row[0], display_name=row[1] or "Без класса", color_hex=row[2] or "#cccccc", count=row[3]
    ) for row in word_dist_rows]

    word_op_rows = db.query(
        models.ComparisonWordOp.op_type, models.ComparisonWordOp.base_token, models.ComparisonWordOp.other_token,
        models.ComparisonWordOp.class_id, models.ClassCatalog.display_name, models.ClassCatalog.color_hex,
        func.count(models.ComparisonWordOp.id).label('count')
    ).outerjoin(models.ClassCatalog, models.ComparisonWordOp.class_id == models.ClassCatalog.id
    ).filter(*changed_filters).group_by(
        models.ComparisonWordOp.op_type, models.ComparisonWordOp.base_token, models.ComparisonWordOp.other_token,
        models.ComparisonWordOp.class_id, models.ClassCatalog.display_name, models.ClassCatalog.color_hex
    ).order_by(desc('count'), models.ComparisonWordOp.op_type, models.ComparisonWordOp.base_token,
               models.ComparisonWordOp.other_token, models.ComparisonWordOp.class_id.asc().nullsfirst()).limit(10).all()
    top_word_ops = [schemas.TopWordOp(
        op_type=row[0], from_token=row[1], to_token=row[2], class_id=row[3],
        display_name=row[4] or "Без класса", color_hex=row[5] or "#cccccc", count=row[6]
    ) for row in word_op_rows]

    # The denominator remains the entire base text for all significance filters.
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
        models.ComparisonCharOp.comparison_id == comp_id,
        *word_filters,
    ).group_by(
        models.ComparisonCharOp.op_type,
        models.ComparisonCharOp.from_str,
        models.ComparisonCharOp.to_str
    )
    char_ops_total = top_char_q.count()
    page_size = 10
    char_ops_pages = max(1, (char_ops_total + page_size - 1) // page_size)
    current_page = min(page, char_ops_pages)
    top_char_q = top_char_q.order_by(
        desc('unique_contexts'), desc('count'), models.ComparisonCharOp.op_type,
        models.ComparisonCharOp.from_str, models.ComparisonCharOp.to_str,
    ).offset((current_page - 1) * page_size).limit(page_size).all()
    
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
        
    
    # Class Distribution
    dist_q = db.query(
        models.ComparisonCharOp.class_id,
        models.ClassCatalog.display_name,
        models.ClassCatalog.color_hex,
        func.count(models.ComparisonCharOp.id).label('count')
    ).join(
        models.ComparisonWordOp, models.ComparisonCharOp.word_op_id == models.ComparisonWordOp.id
    ).outerjoin(
        models.ClassCatalog, models.ComparisonCharOp.class_id == models.ClassCatalog.id
    ).filter(
        models.ComparisonCharOp.comparison_id == comp_id,
        *word_filters,
    ).group_by(
        models.ComparisonCharOp.class_id,
        models.ClassCatalog.display_name,
        models.ClassCatalog.color_hex
    ).all()
    
    class_dist = []
    for d in dist_q:
        class_dist.append(schemas.ClassDistributionItem(
            class_id=d[0],
            display_name=d[1] if d[1] else "Без класса",
            color_hex=d[2] if d[2] else "#cccccc",
            count=d[3]
        ))
        
    return schemas.ComparisonStats(
        totals=totals,
        totals_by_significance=breakdown,
        char_ops_page=current_page,
        char_ops_pages=char_ops_pages,
        char_ops_total=char_ops_total,
        char_ops_page_size=page_size,
        top_word_replacements=top_words,
        top_char_ops=top_chars,
        class_distribution=class_dist,
        top_word_ops=top_word_ops,
        word_class_distribution=word_class_dist,
    )
