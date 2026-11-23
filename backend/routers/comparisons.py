import json
import queue
import threading
import uuid
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
from pydantic import TypeAdapter, ValidationError
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

import algo
from .. import schemas, models, dependencies, database
from ..reconstructed_texts import restore_comparison_texts
from ..class_access import validate_class_ids
from ..preset_matching import PresetMatcher, collect_preset_rules
from .classes import read_classes

router = APIRouter(
    prefix="/comparisons",
    tags=["comparisons"],
)

ComparisonProgress = Optional[Callable[[str, str, int, int], None]]
# (phase, algorithm_label, current, total) — phase: tokenize | alignment | persist

_ALGORITHM_LABELS = {
    "levenshtein": "Левенштейн",
    "levenshtein_nested": "Левенштейн (вложенный)",
    "levenshtein_v2": "Левенштейн 2.0",
    "myers": "Майерс",
}

MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_OPERATIONS = 50000


def word_records(operations):
    """Include preserved replacement snapshots when validating/remapping class IDs."""
    for word in operations:
        yield word
        yield from word.transpose_parts or []



@router.post("/import", response_model=schemas.ComparisonDetail, status_code=201)
def import_comparison(
    file: UploadFile = File(...),
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    """Import the operation array produced by Export JSON, without recomputing it."""
    content = file.file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "JSON file must be no larger than 10 MB")
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise HTTPException(400, "The file must contain valid UTF-8 JSON")
    separators = [" "]
    if isinstance(payload, dict) and payload.get("format") == "textologist-comparison-v2":
        try:
            separators = schemas.TokenizationSettings(separators=payload.get("separators", [" "])).separators
        except ValidationError:
            raise HTTPException(422, "Укажите хотя бы один разделитель; каждый разделитель — один символ")
        payload = payload.get("word_ops")
    if not isinstance(payload, list) or not payload:
        raise HTTPException(422, "Expected a non-empty array of comparison operations (Export JSON format)")
    if len(payload) > MAX_IMPORT_OPERATIONS:
        raise HTTPException(422, "A comparison can contain at most 50,000 operations")
    try:
        word_ops = TypeAdapter(List[schemas.ImportedWordOp]).validate_python(payload)
    except ValidationError as exc:
        error = exc.errors(include_url=False, include_input=False)[0]
        location = ".".join(str(part) for part in error["loc"])
        raise HTTPException(422, f"Invalid comparison operation at {location}: {error['msg']}")

    word_descriptions = {}
    records = list(word_records(word_ops))
    for operation in records:
        if operation.word_class is not None:
            previous = word_descriptions.get(operation.class_id)
            if previous is not None and previous != operation.word_class:
                raise HTTPException(422, "Conflicting word-class descriptions for the same class_id")
            word_descriptions[operation.class_id] = operation.word_class

    filename = (file.filename or "comparison.json").replace("\\", "/").rsplit("/", 1)[-1]
    title = filename.rsplit(".", 1)[0].strip()[:200] or "Импортированное сравнение"
    comp = models.Comparison(owner_user_id=current_user.id, title=title, saved=True, separators=separators)
    try:
        db.add(comp)
        db.flush()
        restore_comparison_texts(db, comp, word_ops)
        # IDs in a file belong to its source database. Never attach them to an
        # unrelated local class, even if that class happens to have the same ID.
        class_ids = sorted({c.class_id for w in records for c in w.char_ops if c.class_id is not None})
        class_map = {}
        import_key = uuid.uuid4().hex
        for source_id in class_ids:
            imported_class = models.ClassCatalog(
                owner_user_id=current_user.id,
                code=f"import:{import_key}:{source_id}",
                display_name=f"Импортированный класс №{source_id}",
                color_hex="#6366f1",
            )
            db.add(imported_class)
            db.flush()
            class_map[source_id] = imported_class.id

        word_class_map = {}
        for source_id in sorted({w.class_id for w in records if w.class_id is not None}):
            description = word_descriptions.get(source_id)
            if description and description.system_key == "insignificant":
                builtin = db.query(models.ClassCatalog).filter_by(system_key="insignificant", kind="word", owner_user_id=None).one()
                word_class_map[source_id] = builtin.id
                continue
            imported_class = models.ClassCatalog(
                owner_user_id=current_user.id,
                code=f"import-word:{import_key}:{source_id}",
                display_name=description.display_name if description else f"Импортированный словесный класс №{source_id}",
                color_hex=description.color_hex if description else "#6366f1",
                kind="word",
            )
            db.add(imported_class)
            db.flush()
            word_class_map[source_id] = imported_class.id

        for index, operation in enumerate(word_ops):
            word = models.ComparisonWordOp(
                comparison_id=comp.id,
                order_index=index,
                op_type=models.WordOpType(operation.op_type.value),
                base_index=operation.base_index,
                other_index=operation.other_index,
                base_token=operation.base_token,
                other_token=operation.other_token,
                base_paragraph_index=operation.base_paragraph_index,
                class_id=word_class_map.get(operation.class_id),
                transpose_parts=[{
                    **part.model_dump(mode="json"),
                    "class_id": word_class_map.get(part.class_id),
                    "char_ops": [{**char.model_dump(mode="json"), "class_id": class_map.get(char.class_id)} for char in part.char_ops],
                } for part in operation.transpose_parts] if operation.transpose_parts else None,
            )
            db.add(word)
            db.flush()
            for char in operation.char_ops:
                db.add(models.ComparisonCharOp(
                    comparison_id=comp.id,
                    word_op_id=word.id,
                    op_type=models.OpType(char.op_type.value),
                    from_str=char.from_str,
                    to_str=char.to_str,
                    class_id=class_map.get(char.class_id),
                    source=models.CharOpSource.manual if char.class_id is not None else models.CharOpSource.classifier,
                ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return read_comparison(comp.id, current_user, db)


@router.patch("/{comp_id}/font", response_model=schemas.ComparisonFontUpdate)
def update_comparison_font(
    comp_id: int,
    request: schemas.ComparisonFontUpdate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    comp = db.query(models.Comparison).filter(
        models.Comparison.id == comp_id,
        models.Comparison.owner_user_id == current_user.id,
    ).first()
    if comp is None:
        raise HTTPException(404, "Comparison not found")
    if request.selected_font_id is not None:
        font = db.query(models.Font).filter(
            models.Font.id == request.selected_font_id,
            models.Font.owner_user_id == current_user.id,
        ).first()
        if font is None:
            raise HTTPException(404, "Font not found")
    comp.selected_font_id = request.selected_font_id
    db.commit()
    return {"selected_font_id": comp.selected_font_id}


@router.patch("/{comp_id}", response_model=schemas.ComparisonRead)
def rename_comparison(
    comp_id: int,
    request: schemas.ComparisonRenameRequest,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    comp = db.query(models.Comparison).filter(
        models.Comparison.id == comp_id,
        models.Comparison.owner_user_id == current_user.id,
    ).first()
    if comp is None:
        raise HTTPException(404, "Comparison not found")
    comp.title = request.title
    db.commit()
    return read_comparison(comp.id, current_user, db)


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

    base_tok_res = algo.tokenize_paragraphs(base_text.extracted_paragraphs_json, comp_data.separators)
    if progress:
        progress("tokenize", algo_label, 1, 2)
    other_tok_res = algo.tokenize_paragraphs(other_text.extracted_paragraphs_json, comp_data.separators)
    if progress:
        progress("tokenize", algo_label, 2, 2)

    weights = algo.Weights(
        replace=comp_data.weights.replace,
        delete=comp_data.weights.delete,
        insert=comp_data.weights.insert,
        transpose=comp_data.weights.transpose,
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

    preset_rules = []
    if comp_data.preset_id:
        preset = db.query(models.Preset).filter(
            models.Preset.id == comp_data.preset_id,
            models.Preset.owner_user_id == current_user.id,
        ).first()
        if not preset:
            raise HTTPException(404, "Preset not found")
        preset_rules = preset.rules
    accessible_classes = {c.id: c for c in read_classes(current_user, db)}
    matcher = PresetMatcher(preset_rules, accessible_classes)

    def classified_char_ops(old, new):
        for character in algo.char_diff(old, new):
            class_id = matcher.character(character.op_type.value, character.from_str, character.to_str, old, new)
            yield dict(op_type=character.op_type.value, from_str=character.from_str, to_str=character.to_str,
                       class_id=class_id)

    db_comp = models.Comparison(
        owner_user_id=current_user.id,
        base_text_id=base_text.id,
        other_text_id=other_text.id,
        separators=comp_data.separators,
        weight_replace=weights.replace,
        weight_delete=weights.delete,
        weight_insert=weights.insert,
        weight_transpose=weights.transpose,
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

        parts = None
        if w_op.op_type == algo.WordOpType.transpose:
            a, b = w_op.transpose_tokens
            parts = [dict(op_type="replace", base_index=w_op.base_index + offset,
                          other_index=w_op.other_index + offset,
                          base_token=old, other_token=new,
                          base_paragraph_index=base_tok_res.token_paragraph_index[w_op.base_index + offset],
                          char_ops=list(classified_char_ops(old, new)), class_id=None)
                     for offset, (old, new) in enumerate([(a, b), (b, a)])]
        db_w_op = models.ComparisonWordOp(
            transpose_parts=parts,
            class_id=matcher.word(w_op.op_type.value, w_op.base_token, w_op.other_token),
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
            for character in classified_char_ops(w_op.base_token, w_op.other_token):
                db.add(models.ComparisonCharOp(
                    comparison_id=db_comp.id, word_op_id=db_w_op.id,
                    source=models.CharOpSource.preset if character['class_id'] is not None else models.CharOpSource.classifier,
                    **character,
                ))

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
    for word in comp.word_ops:
        word.char_ops.sort(key=lambda x: x.id)
    
    # Populate title fields
    comp_detail = schemas.ComparisonDetail.from_orm(comp)
    effective_classes = {cls.id: cls for cls in read_classes(current_user, db) if cls.kind == schemas.ClassKind.word}
    for word in word_records(comp_detail.word_ops):
        cls = effective_classes.get(word.class_id)
        word.word_class = schemas.WordClassDescription.model_validate(cls) if cls else None
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
        validate_class_ids(db, current_user.id, (w.class_id for w in word_records(save_req.word_ops)), "word")
        validate_class_ids(db, current_user.id, (c.class_id for w in word_records(save_req.word_ops) for c in w.char_ops), "char")
        comp.dirty_for_preset = True
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
                order_index=idx,
                class_id=w_op_in.class_id,
                transpose_parts=[p.model_dump(mode="json") for p in w_op_in.transpose_parts] if w_op_in.transpose_parts else None,
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

@router.patch("/{comp_id}/word-classes", response_model=List[schemas.WordOpRead])
def update_word_classes(
    comp_id: int,
    update_data: schemas.WordClassBatchUpdate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    comp = db.query(models.Comparison).filter_by(id=comp_id, owner_user_id=current_user.id).first()
    if comp is None:
        raise HTTPException(404, "Comparison not found")
    ids = set(update_data.word_op_ids)
    words = db.query(models.ComparisonWordOp).filter(
        models.ComparisonWordOp.comparison_id == comp_id,
        models.ComparisonWordOp.id.in_(ids),
    ).all()
    # Validate the entire batch before changing anything: no partial assignments.
    if len(words) != len(ids):
        raise HTTPException(404, "Word operation not found in this comparison")
    if any(word.op_type == models.WordOpType.equal for word in words):
        raise HTTPException(422, "Unchanged words cannot have a word-change class")
    validate_class_ids(db, current_user.id, [update_data.class_id], "word")
    for word in words:
        word.class_id = update_data.class_id
    db.commit()
    detail = read_comparison(comp_id, current_user, db)
    return [word for word in detail.word_ops if word.id in ids]


@router.patch("/word-ops/{word_op_id}", response_model=schemas.WordOpRead)
def update_word_op(
    word_op_id: int,
    update_data: schemas.WordClassUpdate,
    current_user: models.User = Depends(dependencies.get_current_active_user),
    db: Session = Depends(dependencies.get_db),
):
    word = db.query(models.ComparisonWordOp).join(models.Comparison).filter(
        models.ComparisonWordOp.id == word_op_id,
        models.Comparison.owner_user_id == current_user.id,
    ).first()
    if word is None:
        raise HTTPException(404, "Word operation not found")
    if word.op_type == models.WordOpType.equal:
        raise HTTPException(422, "Unchanged words cannot have a word-change class")
    validate_class_ids(db, current_user.id, [update_data.class_id], "word")
    word.class_id = update_data.class_id
    db.commit()
    # Resolve display overrides just as in comparison reads and JSON exports.
    detail = read_comparison(word.comparison_id, current_user, db)
    return next(op for op in detail.word_ops if op.id == word.id)


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
    
    validate_class_ids(db, current_user.id, [update_data.class_id], "char")
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
        
    validate_class_ids(db, current_user.id, [update_data.class_id], "char")
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
        
    classes = {c.id: c for c in read_classes(current_user, db)}
    rules = collect_preset_rules(comp.word_ops, classes)

    new_preset = models.Preset(
        owner_user_id=current_user.id,
        name=data.name,
        description=data.description,
        created_from_text_a_id=comp.base_text_id,
        created_from_text_b_id=comp.other_text_id
    )
    db.add(new_preset)
    db.flush()
    
    for rule in rules:
        db.add(models.PresetRule(preset_id=new_preset.id, **rule))

    comp.dirty_for_preset = False
    db.commit()
    db.refresh(new_preset)
    return new_preset
