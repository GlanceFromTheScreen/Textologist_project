"""Adjacent-only alignment invariants and examples derived from the existing 29.json text."""
import itertools
import json
from functools import lru_cache
from pathlib import Path
import unittest

import algo
from algo.comparison import weighted_levenshtein_char_distance
from algo.distance import distance, operation_cost

ALGORITHMS = ['levenshtein', 'levenshtein_nested', 'levenshtein_v2']


def expand(ops, side):
    result = []
    for op in ops:
        if op.op_type == algo.WordOpType.transpose:
            result.extend(op.transpose_tokens if side == 'base' else reversed(op.transpose_tokens))
        else:
            token = getattr(op, side + '_token')
            if token is not None: result.append(token)
    return result


class TranspositionAlgorithmTests(unittest.TestCase):
    def assert_alignment(self, a, b, algorithm, weights=None):
        weights = weights or algo.Weights()
        ops = algo.compare_tokens(a, b, weights, algorithm)
        self.assertEqual(expand(ops, 'base'), a)
        self.assertEqual(expand(ops, 'other'), b)
        for op in ops:
            if op.op_type == algo.WordOpType.transpose:
                self.assertEqual(a[op.base_index:op.base_index+2], op.transpose_tokens)
                self.assertEqual(b[op.other_index:op.other_index+2], list(reversed(op.transpose_tokens)))
                self.assertNotEqual(*op.transpose_tokens)
        return ops

    def test_exact_neighbors_and_multiple_pairs(self):
        for algorithm in ALGORITHMS:
            ops = self.assert_alignment(['дьни', 'вѣка', 'кот', 'кит'], ['вѣка', 'дьни', 'кит', 'кот'], algorithm)
            self.assertEqual([op.op_type.value for op in ops], ['transpose', 'transpose'])

    def test_no_fuzzy_distant_or_identical_word_transpositions(self):
        for algorithm in ALGORITHMS:
            for a, b in [(['a', 'b'], ['B', 'a']), (['a', 'x', 'b'], ['b', 'x', 'a']), (['a', 'a'], ['a', 'a'])]:
                ops = self.assert_alignment(a, b, algorithm)
                self.assertFalse(any(op.op_type == algo.WordOpType.transpose for op in ops))

    def test_weights_can_choose_a_cheaper_non_transposition_path(self):
        for algorithm in ALGORITHMS:
            ops = self.assert_alignment(['кот', 'кит'], ['кит', 'кот'], algorithm, algo.Weights(transpose=100))
            self.assertFalse(any(op.op_type == algo.WordOpType.transpose for op in ops))
            self.assertGreater(distance(['кот', 'кит'], ['кит', 'кот'], algo.Weights(), algorithm), 0)

    def test_all_short_binary_sequences_have_optimal_unit_cost_and_preserve_tokens(self):
        sequences = [list(items) for size in range(4) for items in itertools.product('ab', repeat=size)]
        for a in sequences:
            for b in sequences:
                @lru_cache(None)
                def optimal(i, j):
                    if i == len(a): return len(b) - j
                    if j == len(b): return len(a) - i
                    candidates = [1 + optimal(i+1, j), 1 + optimal(i, j+1), (a[i] != b[j]) + optimal(i+1, j+1)]
                    if i+1 < len(a) and j+1 < len(b) and a[i] != a[i+1] and a[i] == b[j+1] and a[i+1] == b[j]:
                        candidates.append(1 + optimal(i+2, j+2))
                    return min(candidates)
                for algorithm in ALGORITHMS:
                    ops = self.assert_alignment(a, b, algorithm)
                    self.assertAlmostEqual(sum(operation_cost(op, algo.Weights(), algorithm) for op in ops), optimal(0, 0))

    def test_existing_text_artificial_examples(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/transposition_examples.json').read_text())
        for case in fixture['examples']:
            for algorithm in ALGORITHMS:
                with self.subTest(case=case['name'], algorithm=algorithm):
                    ops = self.assert_alignment(case['base'], case['other'], algorithm)
                    pairs = [op.transpose_tokens for op in ops if op.op_type == algo.WordOpType.transpose]
                    self.assertEqual(pairs, case['expected_pairs'])

    def test_progress_and_unchanged_myers(self):
        for algorithm in ALGORITHMS:
            progress = []
            algo.compare_tokens(['a', 'b'], ['b', 'a'], algo.Weights(), algorithm, lambda current, total: progress.append((current, total)))
            self.assertEqual(progress[-1][0], progress[-1][1])
            self.assertEqual([p[0] for p in progress], sorted(p[0] for p in progress))
        ops = self.assert_alignment(['a','b'], ['b','a'], 'myers')
        self.assertFalse(any(op.op_type == algo.WordOpType.transpose for op in ops))

    def test_nested_distance_uses_normalized_replace_and_transpose_costs(self):
        self.assertAlmostEqual(distance(['кот'], ['кит'], algo.Weights(), 'levenshtein_nested'), 1/3)
        self.assertAlmostEqual(distance(['кот','кит'], ['кит','кот'], algo.Weights(), 'levenshtein_nested'), 1/3)
