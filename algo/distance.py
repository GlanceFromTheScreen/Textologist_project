from .comparison import compare_tokens, weighted_levenshtein_char_distance, calculate_levenshtein_distance
from .structures import Weights, WordOpType
from typing import List


def operation_cost(op, weights: Weights, algorithm: str) -> float:
    if op.op_type == WordOpType.equal:
        return 0.0
    if op.op_type == WordOpType.transpose:
        if algorithm == 'levenshtein_nested':
            a, b = op.transpose_tokens
            return weights.transpose * calculate_levenshtein_distance(a, b) / max(len(a), len(b))
        return weights.transpose
    if op.op_type == WordOpType.replace:
        if algorithm == 'levenshtein_v2':
            return weights.replace * weighted_levenshtein_char_distance(op.base_token, op.other_token, weights.char_delete, weights.char_insert, weights.char_replace)
        if algorithm == 'levenshtein_nested':
            return weights.replace * calculate_levenshtein_distance(op.base_token, op.other_token) / max(len(op.base_token), len(op.other_token))
        return weights.replace
    if op.op_type == WordOpType.delete:
        return weights.delete * (len(op.base_token) if algorithm == 'levenshtein_v2' else 1)
    if op.op_type == WordOpType.insert:
        return weights.insert * (len(op.other_token) if algorithm == 'levenshtein_v2' else 1)
    raise ValueError(f'Unsupported word operation: {op.op_type}')


def distance(base_tokens: List[str], other_tokens: List[str], weights: Weights, algorithm: str = 'levenshtein') -> float:
    return sum(operation_cost(op, weights, algorithm) for op in compare_tokens(base_tokens, other_tokens, weights, algorithm=algorithm))
