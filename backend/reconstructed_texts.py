"""Recover source text content from the ordered operations in a JSON export."""
from . import models


def reconstruct_paragraphs(word_ops, separator=" "):
    """Keep token order and Unicode; infer other-text paragraphs from the base.

    Whitespace and other-text paragraph indices are absent from legacy exports.
    Leading insertions use the first known paragraph; subsequent insertions use
    the preceding paragraph, matching the comparison viewer. Paragraph numbers
    may be sparse or edited, so create blocks rather than allocating by index.
    """
    word_ops = [part for word in word_ops for part in (word.transpose_parts or [word])]
    current = next((op.base_paragraph_index for op in word_ops if op.base_paragraph_index is not None), 0)
    base, other = [], []
    base_tokens, other_tokens = [], []
    for op in word_ops:
        paragraph = op.base_paragraph_index
        if paragraph is not None and paragraph != current:
            if base_tokens:
                base.append(separator.join(base_tokens))
            if other_tokens:
                other.append(separator.join(other_tokens))
            base_tokens, other_tokens = [], []
            current = paragraph
        op_type = getattr(op.op_type, "value", op.op_type)
        if op_type != "insert" and op.base_token is not None:
            base_tokens.append(op.base_token)
        if op_type != "delete" and op.other_token is not None:
            other_tokens.append(op.other_token)
    if base_tokens:
        base.append(separator.join(base_tokens))
    if other_tokens:
        other.append(separator.join(other_tokens))
    return base, other


def restore_comparison_texts(db, comparison, word_ops):
    """Attach missing source texts in the caller's transaction; never overwrite."""
    if comparison.base_text_id is not None and comparison.other_text_id is not None:
        return False
    paragraphs = reconstruct_paragraphs(word_ops, (comparison.separators or [" "])[0])
    title = comparison.title or f"Сравнение №{comparison.id}"
    for index, (relationship, label) in enumerate((("base_text", "Основной текст"), ("other_text", "Сравниваемый текст"))):
        if getattr(comparison, f"{relationship}_id") is not None:
            continue
        text = models.TextModel(
            owner_user_id=comparison.owner_user_id,
            title=f"{title} — {label}",
            source_type=models.SourceType.txt,
            # Reconstructed content lives in the database, not an uploaded file.
            file_path="",
            extracted_paragraphs_json=paragraphs[index],
        )
        db.add(text)
        setattr(comparison, relationship, text)
    db.flush()
    return True
