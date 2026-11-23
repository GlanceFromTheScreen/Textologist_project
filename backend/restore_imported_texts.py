"""One-time backfill for JSON comparisons imported before text recovery existed.

Run: python -m backend.restore_imported_texts
Existing text links and renamed texts are left intact. Safe to rerun.
"""
from . import database, models
from .reconstructed_texts import restore_comparison_texts


def restore_imported_texts(db):
    restored = 0
    comparisons = db.query(models.Comparison).filter(
        models.Comparison.base_text_id.is_(None),
        models.Comparison.other_text_id.is_(None),
    ).with_for_update().all()
    for comparison in comparisons:
        word_ops = db.query(models.ComparisonWordOp).filter_by(comparison_id=comparison.id).order_by(models.ComparisonWordOp.order_index, models.ComparisonWordOp.id).all()
        if restore_comparison_texts(db, comparison, word_ops):
            restored += 1
    db.commit()
    return restored


if __name__ == "__main__":
    with database.SessionLocal() as db:
        print(f"Restored texts for {restore_imported_texts(db)} comparisons.")
