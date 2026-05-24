import difflib
from typing import List
from .structures import CharOp, CharOpType

def char_diff(old_word: str, new_word: str) -> List[CharOp]:
    matcher = difflib.SequenceMatcher(None, old_word, new_word)
    ops = []
    
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            # We usually don't need to store 'equal' char ops for the UI 'badges', 
            # unless we want to show full reconstruction. 
            # Spec says: "show ... atomic-changes ... badges".
            # Usually only diffs are badges.
            pass
        elif tag == 'delete':
            for k in range(i2 - i1):
                ops.append(CharOp(
                    op_type=CharOpType.delete,
                    from_str=old_word[i1 + k],
                    to_str=""
                ))
        elif tag == 'insert':
            for k in range(j2 - j1):
                ops.append(CharOp(
                    op_type=CharOpType.insert,
                    from_str="",
                    to_str=new_word[j1 + k]
                ))
        elif tag == 'replace':
            len_old = i2 - i1
            len_new = j2 - j1
            min_len = min(len_old, len_new)
            
            for k in range(min_len):
                ops.append(CharOp(
                    op_type=CharOpType.change,
                    from_str=old_word[i1 + k],
                    to_str=new_word[j1 + k]
                ))
            
            if len_old > len_new:
                for k in range(min_len, len_old):
                    ops.append(CharOp(
                        op_type=CharOpType.delete,
                        from_str=old_word[i1 + k],
                        to_str=""
                    ))
            elif len_new > len_old:
                for k in range(min_len, len_new):
                    ops.append(CharOp(
                        op_type=CharOpType.insert,
                        from_str="",
                        to_str=new_word[j1 + k]
                    ))
                    
    return ops
