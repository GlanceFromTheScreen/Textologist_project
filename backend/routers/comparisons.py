import json
import queue
import threading
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

import algo
from .. import schemas, models, dependencies, database

router = APIRouter(
    prefix="/comparisons",
    tags=["comparisons"],
)

ComparisonProgress = Optional[Callable[[str, str, int, int], None]]
# (phase, algorithm_label, current, total) — phase: tokenize | alignment | persist

_ALGORITHM_LABELS = {
    "levenshtein": "Levenshtein",
    "levenshtein_nested": "Levenshtein Nested",
    "levenshtein_v2": "Levenshtein 2.0",
    "myers": "Myers (Diff)",
}


def _report_list_progress(
    cb: ComparisonProgress, phase: str, label: str, cur: int, total: int
) -> None:
    if cb is None or total <= 0:
        return
    step = max(1, total // 100)
    if cur == 1 or cur == total or cur % step == 0:
        cb(phase, label, cur, total)


def execute_comparison(
    db: Session,
    current_user: models.User,
    comp_data: schemas.ComparisonCreate,
    progress: ComparisonProgress = None,
) -> models.Comparison:
    base_text = db.query(models.TextModel).filter(models.TextModel.id == comp_data.base_text_id).first()
    other_text = db.query(models.TextModel).filter(models.TextModel.id == comp_data.other_text_id).first()

    if not base_text or not other_text:
        raise HTTPException(status_code=404, detail="One or both texts not found")

    if base_text.owner_user_id != current_user.id or other_text.owner_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to use these texts")

    algorithm_name = comp_data.algorithm.value if comp_data.algorithm else "levenshtein"
    algo_label = _ALGORITHM_LABELS.get(algorithm_name, algorithm_name)

    base_tok_res = algo.tokenize_paragraphs(base_text.extracted_paragraphs_json)
    if progress:
        progress("tokenize", algo_label, 1, 2)
    other_tok_res = algo.tokenize_paragraphs(other_text.extracted_paragraphs_json)
    if progress:
        progress("tokenize", algo_label, 2, 2)

    weights = algo.Weights(
        replace=comp_data.weights.replace,
        delete=comp_data.weights.delete,
        insert=comp_data.weights.insert,
        char_replace=comp_data.weights.char_replace,
        char_delete=comp_data.weights.char_delete,
        char_insert=comp_data.weights.char_insert,
    )

    def align_progress(cur: int, tot: int) -> None:
        if progress:
            progress("alignment", algo_label, cur, tot)

    word_ops_result = algo.compare_tokens(
        base_tok_res.tokens,
        other_tok_res.tokens,
        weights,
        algorithm=algorithm_name,
        progress_callback=align_progress if progress else None,
    )

    preset_rules_map = {}
    if comp_data.preset_id:
        preset = db.query(models.Preset).filter(
            models.Preset.id == comp_data.preset_id,
            models.Preset.owner_user_id == current_user.id,
        ).first()
        if preset:
            rules = db.query(models.PresetRule).filter(models.PresetRule.preset_id == preset.id).all()
            for rule in rules:
                key = (rule.op_type.value, rule.from_str, rule.to_str)
                preset_rules_map[key] = rule.class_id

    db_comp = models.Comparison(
        owner_user_id=current_user.id,
        base_text_id=base_text.id,
        other_text_id=other_text.id,
        weight_replace=weights.replace,
        weight_delete=weights.delete,
        weight_insert=weights.insert,
        algorithm=models.ComparisonAlgorithm(algorithm_name),
        selected_font_id=comp_data.font_id,
        selected_preset_id=comp_data.preset_id,
        saved=False,
    )
    db.add(db_comp)
    db.flush()

    total_ops = len(word_ops_result)
    for idx, w_op in enumerate(word_ops_result):
        _report_list_progress(progress, "persist", algo_label, idx + 1, total_ops)

        base_para_idx = None
        if w_op.base_index is not None:
            if w_op.base_index < len(base_tok_res.token_paragraph_index):
                base_para_idx = base_tok_res.token_paragraph_index[w_op.base_index]

        db_w_op = models.ComparisonWordOp(
            comparison_id=db_comp.id,
            op_type=models.WordOpType(w_op.op_type.value),
            base_index=w_op.base_index,
            other_index=w_op.other_index,
            base_token=w_op.base_token,
            other_token=w_op.other_token,
            base_paragraph_index=base_para_idx,
            order_index=idx,
        )
        db.add(db_w_op)
        db.flush()

        if w_op.op_type == algo.WordOpType.replace:
            c_ops = algo.char_diff(w_op.base_token, w_op.other_token)
            for c_op in c_ops:
                class_code = algo.classify_graphic(c_op, w_op.base_token, w_op.other_token)
                class_id = None
                source = models.CharOpSource.classifier

                rule_key = (c_op.op_type.value, c_op.from_str, c_op.to_str)
                if rule_key in preset_rules_map:
                    class_id = preset_rules_map[rule_key]
                    source = models.CharOpSource.preset

                db_c_op = models.ComparisonCharOp(
                    comparison_id=db_comp.id,
                    word_op_id=db_w_op.id,
                    op_type=models.OpType(c_op.op_type.value),
                    from_str=c_op.from_str,
                    to_str=c_op.to_str,
                    class_id=class_id,
                    source=source,
                )
                db.add(db_c_op)

    db.commit()
    db.refresh(db_comp)
    return db_comp


@router.post("/run", response_model=schemas.ComparisonDetail)
def run_comparison(
    comp_data: schemas.ComparisonCreate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    return execute_comparison(db, current_user, comp_data, progress=None)


@router.post("/run-stream")
def run_comparison_stream(
    comp_data: schemas.ComparisonCreate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
):
    event_q: queue.Queue = queue.Queue()
    user_id = current_user.id

    def worker() -> None:
        db = database.SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            if not user:
                event_q.put({"type": "error", "detail": "User not found"})
                return

            def on_progress(phase: str, algo: str, cur: int, tot: int) -> None:
                event_q.put(
                    {
                        "type": "progress",
                        "phase": phase,
                        "algorithm": algo,
                        "current": cur,
                        "total": tot,
                    }
                )

            db_comp = execute_comparison(db, user, comp_data, progress=on_progress)
            event_q.put({"type": "done", "id": db_comp.id})
        except HTTPException as he:
            db.rollback()
            event_q.put({"type": "error", "detail": he.detail, "status_code": he.status_code})
        except Exception as e:
            db.rollback()
            event_q.put({"type": "error", "detail": str(e)})
        finally:
            db.close()
            event_q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_gen():
        while True:
            item = event_q.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.post("/calc-char-diff", response_model=List[schemas.CharOpRead])
def calculate_char_diff(
    req: schemas.CharDiffRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user)
):
    c_ops = algo.char_diff(req.base_token, req.other_token)
    result = []
    for c_op in c_ops:
        result.append(schemas.CharOpRead(
            id=0, 
            op_type=schemas.OpType(c_op.op_type.value),
            from_str=c_op.from_str,
            to_str=c_op.to_str,
            class_id=None
        ))
    return result

@router.get("/", response_model=List[schemas.ComparisonRead])
def read_comparisons(
    skip: int = 0, 
    limit: int = 100, 
    saved_only: bool = True,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    query = db.query(models.Comparison).filter(models.Comparison.owner_user_id == current_user.id)
    
    if saved_only:
        query = query.filter(models.Comparison.saved == True)
        
    comparisons = query.order_by(desc(models.Comparison.created_at)).offset(skip).limit(limit).all()
    
    # Populate title fields manually
    result = []
    for comp in comparisons:
        comp_read = schemas.ComparisonRead.from_orm(comp)
        if comp.base_text:
            comp_read.base_text_title = comp.base_text.title
        if comp.other_text:
            comp_read.other_text_title = comp.other_text.title
        result.append(comp_read)
        
    return result

@router.get("/{comp_id}", response_model=schemas.ComparisonDetail)
def read_comparison(
    comp_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
    
    # Sort word_ops by order_index
    comp.word_ops.sort(key=lambda x: x.order_index)
    
    # Populate title fields
    comp_detail = schemas.ComparisonDetail.from_orm(comp)
    if comp.base_text:
        comp_detail.base_text_title = comp.base_text.title
    if comp.other_text:
        comp_detail.other_text_title = comp.other_text.title
        
    return comp_detail

@router.post("/{comp_id}/save")
def save_comparison(
    comp_id: int,
    save_req: schemas.ComparisonSaveRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    if save_req.word_ops is not None:
        db.query(models.ComparisonWordOp).filter(models.ComparisonWordOp.comparison_id == comp_id).delete(synchronize_session=False)
        db.flush()
        
        for idx, w_op_in in enumerate(save_req.word_ops):
            db_w_op = models.ComparisonWordOp(
                comparison_id=comp.id,
                op_type=models.WordOpType(w_op_in.op_type.value),
                base_index=w_op_in.base_index,
                other_index=w_op_in.other_index,
                base_token=w_op_in.base_token,
                other_token=w_op_in.other_token,
                base_paragraph_index=w_op_in.base_paragraph_index,
                order_index=idx
            )
            db.add(db_w_op)
            db.flush()
            
            for c_op_in in w_op_in.char_ops:
                db_c_op = models.ComparisonCharOp(
                    comparison_id=comp.id,
                    word_op_id=db_w_op.id,
                    op_type=models.OpType(c_op_in.op_type.value),
                    from_str=c_op_in.from_str,
                    to_str=c_op_in.to_str,
                    class_id=c_op_in.class_id,
                    source=models.CharOpSource.manual if c_op_in.class_id else models.CharOpSource.classifier
                )
                db.add(db_c_op)

    comp.saved = True
    db.commit()
    return {"ok": True}

@router.delete("/cleanup")
def cleanup_unsaved_comparisons(
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    # Relies on ON DELETE CASCADE in DB
    deleted_count = db.query(models.Comparison).filter(
        models.Comparison.owner_user_id == current_user.id,
        models.Comparison.saved == False
    ).delete()
    
    db.commit()
    return {"deleted": deleted_count}

@router.delete("/{comp_id}")
def delete_comparison(
    comp_id: int,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    db.delete(comp)
    db.commit()
    return {"ok": True}

@router.patch("/char-ops/{char_op_id}", response_model=schemas.CharOpRead)
def update_char_op(
    char_op_id: int,
    update_data: schemas.CharOpUpdate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    char_op = db.query(models.ComparisonCharOp).join(models.Comparison).filter(
        models.ComparisonCharOp.id == char_op_id,
        models.Comparison.owner_user_id == current_user.id
    ).first()
    
    if not char_op:
        raise HTTPException(status_code=404, detail="CharOp not found")
    
    char_op.class_id = update_data.class_id
    char_op.source = models.CharOpSource.manual
    char_op.comparison.dirty_for_preset = True
    
    db.commit()
    db.refresh(char_op)
    return char_op

@router.get("/{comp_id}/char-op-group", response_model=schemas.CharOpGroupResponse)
def get_char_op_group(
    comp_id: int,
    op_type: str,
    from_str: str,
    to_str: str,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    ops = db.query(models.ComparisonCharOp).join(models.ComparisonWordOp).filter(
        models.ComparisonCharOp.comparison_id == comp_id,
        models.ComparisonCharOp.op_type == op_type,
        models.ComparisonCharOp.from_str == from_str,
        models.ComparisonCharOp.to_str == to_str
    ).all()
    
    items = []
    for op in ops:
        items.append(schemas.CharOpGroupItem(
            char_op_id=op.id,
            old_word=op.word_op.base_token if op.word_op else None,
            new_word=op.word_op.other_token if op.word_op else None,
            paragraph_index=op.word_op.base_paragraph_index if op.word_op else None,
            class_id=op.class_id
        ))
        
    return schemas.CharOpGroupResponse(
        group_key=f"{op_type}|{from_str}|{to_str}",
        items=items
    )

@router.patch("/{comp_id}/char-op-group")
def update_char_op_group(
    comp_id: int,
    update_data: schemas.CharOpGroupUpdate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    db.query(models.ComparisonCharOp).filter(
        models.ComparisonCharOp.comparison_id == comp_id,
        models.ComparisonCharOp.op_type == update_data.op_type,
        models.ComparisonCharOp.from_str == update_data.from_str,
        models.ComparisonCharOp.to_str == update_data.to_str
    ).update({
        models.ComparisonCharOp.class_id: update_data.class_id,
        models.ComparisonCharOp.source: models.CharOpSource.manual
    }, synchronize_session=False)
    
    comp.dirty_for_preset = True
    db.commit()
    
    return {"ok": True}

@router.post("/{comp_id}/save-as-preset", response_model=schemas.PresetRead)
def save_as_preset(
    comp_id: int,
    data: schemas.SaveAsPresetRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db)
):
    comp = db.query(models.Comparison).filter(models.Comparison.id == comp_id, models.Comparison.owner_user_id == current_user.id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Comparison not found")
        
    ops = db.query(models.ComparisonCharOp).filter(models.ComparisonCharOp.comparison_id == comp_id).all()
    
    groups = {}
    for op in ops:
        key = (op.op_type, op.from_str, op.to_str)
        if key not in groups:
            groups[key] = []
        groups[key].append(op)
        
    new_preset = models.Preset(
        owner_user_id=current_user.id,
        name=data.name,
        description=data.description,
        created_from_text_a_id=comp.base_text_id,
        created_from_text_b_id=comp.other_text_id
    )
    db.add(new_preset)
    db.flush()
    
    for key, group_ops in groups.items():
        op_type, from_str, to_str = key
        
        candidates = []
        for op in group_ops:
             if op.class_id:
                 c_name = op.assigned_class.display_name if op.assigned_class else ""
                 candidates.append({'class_id': op.class_id, 'class_name': c_name})
             else:
                 candidates.append({'class_id': None, 'class_name': ""})
        
        non_nulls = [c for c in candidates if c['class_id'] is not None]
        final_class_id = None
        
        if non_nulls:
            non_nulls.sort(key=lambda x: x['class_name'])
            final_class_id = non_nulls[0]['class_id']
        
        rule = models.PresetRule(
            preset_id=new_preset.id,
            op_type=op_type,
            from_str=from_str,
            to_str=to_str,
            class_id=final_class_id
        )
        db.add(rule)
        
    comp.dirty_for_preset = False
    db.commit()
    db.refresh(new_preset)
    return new_preset
