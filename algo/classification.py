from typing import Optional
from .structures import CharOp, CharOpType

def classify_graphic(char_op: CharOp, old_word: str, new_word: str) -> Optional[str]:
    # Basic classifier example
    if char_op.op_type == CharOpType.change:
        if char_op.from_str.lower() == char_op.to_str.lower():
            return "case_change"
        # Can add more rules: e.g. e -> ё
        if char_op.from_str == 'е' and char_op.to_str == 'ё':
            return "yo_correction"
        if char_op.from_str == 'ё' and char_op.to_str == 'е':
            return "yo_correction"
            
    return None
