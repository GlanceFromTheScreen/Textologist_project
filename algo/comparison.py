import difflib
from typing import Callable, List, Optional, Tuple

from .structures import WordOp, WordOpType, Weights

# (current_iteration, total_iterations) for the active alignment / Myers build phase
AlignmentProgress = Optional[Callable[[int, int], None]]


def _alignment_total_steps(n: int, m: int) -> int:
    """Interior DP cells plus backtrack steps (upper bound)."""
    return max(1, n * m + n + m)


def _report_alignment_progress(cb: AlignmentProgress, cur: int, total: int) -> None:
    if cb is None or total <= 0:
        return
    step = max(1, total // 100)
    if cur <= 0:
        return
    if cur == 1 or cur == total or cur % step == 0:
        cb(min(cur, total), total)


def _myers_build_total(opcodes: List[Tuple[str, int, int, int, int]]) -> int:
    total = 0
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            total += i2 - i1
        elif tag == "delete":
            total += i2 - i1
        elif tag == "insert":
            total += j2 - j1
        elif tag == "replace":
            len_b, len_o = i2 - i1, j2 - j1
            total += min(len_b, len_o) + abs(len_b - len_o)
    return max(total, 1)


def compare_tokens_myers(
    base_tokens: List[str],
    other_tokens: List[str],
    weights: Weights,
    progress_callback: AlignmentProgress = None,
) -> List[WordOp]:
    # NOTE: We use difflib (Myers algorithm) for global alignment because strict Levenshtein
    # on 20k words is O(N^2) and too slow for Python. 
    # Weights are currently ignored for the *alignment* phase in this MVP implementation
    # but could be used if we switched to a custom DP implementation (or C extension).
    
    matcher = difflib.SequenceMatcher(None, base_tokens, other_tokens)
    opcodes = list(matcher.get_opcodes())
    build_total = _myers_build_total(opcodes)
    ops: List[WordOp] = []
    cur = 0

    for tag, i1, i2, j1, j2 in opcodes:
        if tag == 'equal':
            for k in range(i2 - i1):
                cur += 1
                _report_alignment_progress(progress_callback, cur, build_total)
                ops.append(WordOp(
                    op_type=WordOpType.equal,
                    base_index=i1 + k,
                    other_index=j1 + k,
                    base_token=base_tokens[i1 + k],
                    other_token=other_tokens[j1 + k]
                ))
        elif tag == 'delete':
            for k in range(i2 - i1):
                cur += 1
                _report_alignment_progress(progress_callback, cur, build_total)
                ops.append(WordOp(
                    op_type=WordOpType.delete,
                    base_index=i1 + k,
                    other_index=None,
                    base_token=base_tokens[i1 + k],
                    other_token=None
                ))
        elif tag == 'insert':
            for k in range(j2 - j1):
                cur += 1
                _report_alignment_progress(progress_callback, cur, build_total)
                ops.append(WordOp(
                    op_type=WordOpType.insert,
                    base_index=None, # Insert is 'between' base indices, but effectively doesn't consume one
                    other_index=j1 + k,
                    base_token=None,
                    other_token=other_tokens[j1 + k]
                ))
        elif tag == 'replace':
            # Block replace base[i1:i2] -> other[j1:j2]
            len_base = i2 - i1
            len_other = j2 - j1
            
            # Heuristic: 1-to-1 match as many as possible as replaces
            min_len = min(len_base, len_other)
            
            for k in range(min_len):
                cur += 1
                _report_alignment_progress(progress_callback, cur, build_total)
                ops.append(WordOp(
                    op_type=WordOpType.replace,
                    base_index=i1 + k,
                    other_index=j1 + k,
                    base_token=base_tokens[i1 + k],
                    other_token=other_tokens[j1 + k]
                ))
            
            # Handle excess
            if len_base > len_other:
                # More deletes needed
                for k in range(min_len, len_base):
                    cur += 1
                    _report_alignment_progress(progress_callback, cur, build_total)
                    ops.append(WordOp(
                        op_type=WordOpType.delete,
                        base_index=i1 + k,
                        other_index=None,
                        base_token=base_tokens[i1 + k],
                        other_token=None
                    ))
            elif len_other > len_base:
                # More inserts needed
                for k in range(min_len, len_other):
                    cur += 1
                    _report_alignment_progress(progress_callback, cur, build_total)
                    ops.append(WordOp(
                        op_type=WordOpType.insert,
                        base_index=None,
                        other_index=j1 + k,
                        base_token=None,
                        other_token=other_tokens[j1 + k]
                    ))

    if progress_callback:
        progress_callback(build_total, build_total)

    return ops

def weighted_levenshtein_char_distance(
    s1: str,
    s2: str,
    w_delete: float,
    w_insert: float,
    w_replace: float,
) -> float:
    """Levenshtein distance between two strings with per-operation weights."""
    if s1 == s2:
        return 0.0
    rows = len(s1) + 1
    cols = len(s2) + 1
    dist = [[0.0 for _ in range(cols)] for _ in range(rows)]
    for i in range(1, rows):
        dist[i][0] = dist[i - 1][0] + w_delete
    for j in range(1, cols):
        dist[0][j] = dist[0][j - 1] + w_insert
    for i in range(1, rows):
        for j in range(1, cols):
            sub_cost = 0.0 if s1[i - 1] == s2[j - 1] else w_replace
            dist[i][j] = min(
                dist[i - 1][j] + w_delete,
                dist[i][j - 1] + w_insert,
                dist[i - 1][j - 1] + sub_cost,
            )
    return dist[rows - 1][cols - 1]


def calculate_levenshtein_distance(s1: str, s2: str) -> int:
    """Standard Levenshtein distance for strings (unit weights)."""
    return int(weighted_levenshtein_char_distance(s1, s2, 1.0, 1.0, 1.0))

def compare_tokens_levenshtein_nested(
    base_tokens: List[str],
    other_tokens: List[str],
    weights: Weights,
    progress_callback: AlignmentProgress = None,
) -> List[WordOp]:
    n = len(base_tokens)
    m = len(other_tokens)
    align_total = _alignment_total_steps(n, m)
    align_cur = 0

    # Initialize DP matrix
    # dp[i][j] stores tuple: (min_cost, parent_op_type)
    # parent_op_type: 0=start, 1=match/replace, 2=delete, 3=insert
    
    dp = [[(0.0, 0)] * (m + 1) for _ in range(n + 1)]

    # Fill boundaries
    for i in range(1, n + 1):
        dp[i][0] = (dp[i-1][0][0] + weights.delete, 2)
    for j in range(1, m + 1):
        dp[0][j] = (dp[0][j-1][0] + weights.insert, 3)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            align_cur += 1
            _report_alignment_progress(progress_callback, align_cur, align_total)
            base_t = base_tokens[i-1]
            other_t = other_tokens[j-1]
            
            # Calculate costs
            if base_t == other_t:
                cost_diag = dp[i-1][j-1][0] # Match (cost 0)
                is_match = True
            else:
                # Nested logic: scale replace weight by character similarity
                char_dist = calculate_levenshtein_distance(base_t, other_t)
                max_len = max(len(base_t), len(other_t))
                
                # Avoid division by zero (though max_len should be > 0 if words are different)
                similarity_factor = char_dist / max_len if max_len > 0 else 1.0
                
                # Cost is proportional to how different the words are
                cost_diag = dp[i-1][j-1][0] + (weights.replace * similarity_factor)
                is_match = False
                
            cost_del = dp[i-1][j][0] + weights.delete
            cost_ins = dp[i][j-1][0] + weights.insert

            # print("char dist: ", base_t, other_t, cost_diag, cost_del, cost_ins)
            
            # Select min
            if cost_diag <= cost_del and cost_diag <= cost_ins:
                dp[i][j] = (cost_diag, 1) # Match/Replace
            elif cost_del <= cost_ins:
                dp[i][j] = (cost_del, 2) # Delete
            else:
                dp[i][j] = (cost_ins, 3) # Insert

    # print(dp)

    # Backtrack (Identical to standard Levenshtein)
    ops = []
    i, j = n, m
    
    while i > 0 or j > 0:
        align_cur += 1
        _report_alignment_progress(progress_callback, align_cur, align_total)
        _, op_type = dp[i][j]
        
        if op_type == 1: # Match or Replace
            base_t = base_tokens[i-1]
            other_t = other_tokens[j-1]
            if base_t == other_t:
                 ops.append(WordOp(
                    op_type=WordOpType.equal,
                    base_index=i-1,
                    other_index=j-1,
                    base_token=base_t,
                    other_token=other_t
                ))
            else:
                ops.append(WordOp(
                    op_type=WordOpType.replace,
                    base_index=i-1,
                    other_index=j-1,
                    base_token=base_t,
                    other_token=other_t
                ))
            i -= 1
            j -= 1
        elif op_type == 2: # Delete
            ops.append(WordOp(
                op_type=WordOpType.delete,
                base_index=i-1,
                other_index=None,
                base_token=base_tokens[i-1],
                other_token=None
            ))
            i -= 1
        elif op_type == 3: # Insert
            ops.append(WordOp(
                op_type=WordOpType.insert,
                base_index=None,
                other_index=j-1,
                base_token=None,
                other_token=other_tokens[j-1]
            ))
            j -= 1
        elif i > 0: # Fallback
             ops.append(WordOp(op_type=WordOpType.delete, base_index=i-1, other_index=None, base_token=base_tokens[i-1], other_token=None))
             i -= 1
        elif j > 0: # Fallback
             ops.append(WordOp(op_type=WordOpType.insert, base_index=None, other_index=j-1, base_token=None, other_token=other_tokens[j-1]))
             j -= 1

    ops.reverse()
    if progress_callback:
        progress_callback(align_total, align_total)
    return ops

def compare_tokens_levenshtein(
    base_tokens: List[str],
    other_tokens: List[str],
    weights: Weights,
    progress_callback: AlignmentProgress = None,
) -> List[WordOp]:
    n = len(base_tokens)
    m = len(other_tokens)
    align_total = _alignment_total_steps(n, m)
    align_cur = 0

    dp = [[(0.0, 0)] * (m + 1) for _ in range(n + 1)]

    # Fill boundaries
    for i in range(1, n + 1):
        dp[i][0] = (dp[i-1][0][0] + weights.delete, 2)
    for j in range(1, m + 1):
        dp[0][j] = (dp[0][j-1][0] + weights.insert, 3)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            align_cur += 1
            _report_alignment_progress(progress_callback, align_cur, align_total)
            base_t = base_tokens[i-1]
            other_t = other_tokens[j-1]
            
            # Calculate costs
            if base_t == other_t:
                cost_diag = dp[i-1][j-1][0] # Match (cost 0)
                is_match = True
            else:
                cost_diag = dp[i-1][j-1][0] + weights.replace
                is_match = False
                
            cost_del = dp[i-1][j][0] + weights.delete
            cost_ins = dp[i][j-1][0] + weights.insert
            
            # Select min
            if cost_diag <= cost_del and cost_diag <= cost_ins:
                dp[i][j] = (cost_diag, 1) # Match/Replace
            elif cost_del <= cost_ins:
                dp[i][j] = (cost_del, 2) # Delete
            else:
                dp[i][j] = (cost_ins, 3) # Insert

    # Backtrack
    ops = []
    i, j = n, m
    
    while i > 0 or j > 0:
        align_cur += 1
        _report_alignment_progress(progress_callback, align_cur, align_total)
        _, op_type = dp[i][j]
        
        if op_type == 1: # Match or Replace
            base_t = base_tokens[i-1]
            other_t = other_tokens[j-1]
            if base_t == other_t:
                 ops.append(WordOp(
                    op_type=WordOpType.equal,
                    base_index=i-1,
                    other_index=j-1,
                    base_token=base_t,
                    other_token=other_t
                ))
            else:
                ops.append(WordOp(
                    op_type=WordOpType.replace,
                    base_index=i-1,
                    other_index=j-1,
                    base_token=base_t,
                    other_token=other_t
                ))
            i -= 1
            j -= 1
        elif op_type == 2: # Delete
            ops.append(WordOp(
                op_type=WordOpType.delete,
                base_index=i-1,
                other_index=None,
                base_token=base_tokens[i-1],
                other_token=None
            ))
            i -= 1
        elif op_type == 3: # Insert
            ops.append(WordOp(
                op_type=WordOpType.insert,
                base_index=None,
                other_index=j-1,
                base_token=None,
                other_token=other_tokens[j-1]
            ))
            j -= 1
        elif i > 0: 
             ops.append(WordOp(op_type=WordOpType.delete, base_index=i-1, other_index=None, base_token=base_tokens[i-1], other_token=None))
             i -= 1
        elif j > 0:
             ops.append(WordOp(op_type=WordOpType.insert, base_index=None, other_index=j-1, base_token=None, other_token=other_tokens[j-1]))
             j -= 1

    ops.reverse()
    if progress_callback:
        progress_callback(align_total, align_total)
    return ops


def compare_tokens_levenshtein_v2(
    base_tokens: List[str],
    other_tokens: List[str],
    weights: Weights,
    progress_callback: AlignmentProgress = None,
) -> List[WordOp]:
    """
    Word-level edit distance where:
    - insert cost = weights.insert * len(inserted token)
    - delete cost = weights.delete * len(deleted token)
    - replace cost = weights.replace * weighted character-level Levenshtein
      (inner costs: char_delete, char_insert, char_replace; default 1)
    """
    n = len(base_tokens)
    m = len(other_tokens)
    align_total = _alignment_total_steps(n, m)
    align_cur = 0
    cw = weights.char_delete
    ci = weights.char_insert
    cr = weights.char_replace
    wd = weights.delete
    wi = weights.insert
    wr = weights.replace

    dp = [[(0.0, 0)] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        token = base_tokens[i - 1]
        dp[i][0] = (dp[i - 1][0][0] + wd * float(len(token)), 2)
    for j in range(1, m + 1):
        token = other_tokens[j - 1]
        dp[0][j] = (dp[0][j - 1][0] + wi * float(len(token)), 3)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            align_cur += 1
            _report_alignment_progress(progress_callback, align_cur, align_total)
            base_t = base_tokens[i - 1]
            other_t = other_tokens[j - 1]

            if base_t == other_t:
                cost_diag = dp[i - 1][j - 1][0]
            else:
                char_cost = weighted_levenshtein_char_distance(base_t, other_t, cw, ci, cr)
                cost_diag = dp[i - 1][j - 1][0] + wr * char_cost

            cost_del = dp[i - 1][j][0] + wd * float(len(base_t))
            cost_ins = dp[i][j - 1][0] + wi * float(len(other_t))

            if cost_diag <= cost_del and cost_diag <= cost_ins:
                dp[i][j] = (cost_diag, 1)
            elif cost_del <= cost_ins:
                dp[i][j] = (cost_del, 2)
            else:
                dp[i][j] = (cost_ins, 3)

    ops: List[WordOp] = []
    i, j = n, m

    while i > 0 or j > 0:
        align_cur += 1
        _report_alignment_progress(progress_callback, align_cur, align_total)
        _, op_type = dp[i][j]

        if op_type == 1:
            base_t = base_tokens[i - 1]
            other_t = other_tokens[j - 1]
            if base_t == other_t:
                ops.append(
                    WordOp(
                        op_type=WordOpType.equal,
                        base_index=i - 1,
                        other_index=j - 1,
                        base_token=base_t,
                        other_token=other_t,
                    )
                )
            else:
                ops.append(
                    WordOp(
                        op_type=WordOpType.replace,
                        base_index=i - 1,
                        other_index=j - 1,
                        base_token=base_t,
                        other_token=other_t,
                    )
                )
            i -= 1
            j -= 1
        elif op_type == 2:
            ops.append(
                WordOp(
                    op_type=WordOpType.delete,
                    base_index=i - 1,
                    other_index=None,
                    base_token=base_tokens[i - 1],
                    other_token=None,
                )
            )
            i -= 1
        elif op_type == 3:
            ops.append(
                WordOp(
                    op_type=WordOpType.insert,
                    base_index=None,
                    other_index=j - 1,
                    base_token=None,
                    other_token=other_tokens[j - 1],
                )
            )
            j -= 1
        elif i > 0:
            ops.append(
                WordOp(
                    op_type=WordOpType.delete,
                    base_index=i - 1,
                    other_index=None,
                    base_token=base_tokens[i - 1],
                    other_token=None,
                )
            )
            i -= 1
        elif j > 0:
            ops.append(
                WordOp(
                    op_type=WordOpType.insert,
                    base_index=None,
                    other_index=j - 1,
                    base_token=None,
                    other_token=other_tokens[j - 1],
                )
            )
            j -= 1

    ops.reverse()
    if progress_callback:
        progress_callback(align_total, align_total)
    return ops


def compare_tokens(
    base_tokens: List[str],
    other_tokens: List[str],
    weights: Weights,
    algorithm: str = "myers",
    progress_callback: AlignmentProgress = None,
) -> List[WordOp]:
    if algorithm == "levenshtein":
        return compare_tokens_levenshtein(base_tokens, other_tokens, weights, progress_callback)
    elif algorithm == "levenshtein_nested":
        return compare_tokens_levenshtein_nested(base_tokens, other_tokens, weights, progress_callback)
    elif algorithm == "levenshtein_v2":
        return compare_tokens_levenshtein_v2(base_tokens, other_tokens, weights, progress_callback)
    else:
        # Default to Myers
        return compare_tokens_myers(base_tokens, other_tokens, weights, progress_callback)
