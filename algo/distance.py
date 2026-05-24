from .comparison import compare_tokens, weighted_levenshtein_char_distance
from .structures import Weights, WordOpType
from typing import List


def distance(base_tokens: List[str], other_tokens: List[str], weights: Weights, algorithm: str = "levenshtein") -> float:
    ops = compare_tokens(base_tokens, other_tokens, weights, algorithm=algorithm)
    dist = 0.0
    for op in ops:
        if algorithm == "levenshtein_v2":
            if op.op_type == WordOpType.replace and op.base_token is not None and op.other_token is not None:
                dist += weights.replace * weighted_levenshtein_char_distance(
                    op.base_token,
                    op.other_token,
                    weights.char_delete,
                    weights.char_insert,
                    weights.char_replace,
                )
            elif op.op_type == WordOpType.delete and op.base_token is not None:
                dist += weights.delete * float(len(op.base_token))
            elif op.op_type == WordOpType.insert and op.other_token is not None:
                dist += weights.insert * float(len(op.other_token))
        elif op.op_type == WordOpType.replace:
            dist += weights.replace
        elif op.op_type == WordOpType.delete:
            dist += weights.delete
        elif op.op_type == WordOpType.insert:
            dist += weights.insert
    return dist
