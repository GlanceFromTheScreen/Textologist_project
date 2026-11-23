import json
from typing import List, Dict, Any, Optional, Tuple

def load_ops(file_path: str) -> List[Dict[str, Any]]:
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def add_base_indices(ops: List[Dict[str, Any]]):
    """
    Mutates ops by adding a calculated 'base_idx' to equal, delete, replace.
    And a 'virtual_pos' to inserts to help match them.
    """
    base_idx = 0
    for i, op in enumerate(ops):
        op['_list_idx'] = i
        if op['op_type'] in ('equal', 'delete', 'replace', 'transpose'):
            op['base_idx'] = base_idx
            base_idx += 2 if op["op_type"] == "transpose" else 1
        elif op['op_type'] == 'insert':
            op['base_idx'] = base_idx - 0.5  # virtual position between tokens

def evaluate_comparisons(comp1_ops: List[Dict[str, Any]], comp2_ops: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compares two lists of WordOps (comp1 is ground truth / canonical, comp2 is prediction).
    Returns recall, precision, and the aligned elements for each step.
    """
    # Create deep copies so we don't mutate original dictionaries if passed directly
    comp1 = [dict(op) for op in comp1_ops]
    comp2 = [dict(op) for op in comp2_ops]
    
    add_base_indices(comp1)
    add_base_indices(comp2)
    
    comp2_by_base_idx = {op['base_idx']: op for op in comp2 if op['op_type'] in ('equal', 'delete', 'replace', 'transpose')}
    comp1_by_base_idx = {op['base_idx']: op for op in comp1 if op['op_type'] in ('equal', 'delete', 'replace', 'transpose')}
    
    matched_elements_recall = []
    
    # 1. Iterate over comp1 to calculate Recall elements
    for op1 in comp1:
        if op1['op_type'] in ('equal', 'delete', 'replace', 'transpose'):
            base_idx = op1['base_idx']
            op2 = comp2_by_base_idx.get(base_idx)
            matched_elements_recall.append({
                'op1': op1['op_type'],
                'op2': op2['op_type'] if op2 else None,
                'other_token1': op1.get('other_token'),
                'other_token2': op2.get('other_token') if op2 else None,
                'base_token': op1.get('base_token')
            })
        elif op1['op_type'] == 'insert':
            base_anchor = int(op1['base_idx'] + 0.5)
            anchor_op2 = comp2_by_base_idx.get(base_anchor)
            anchor_list_idx = anchor_op2['_list_idx'] if anchor_op2 else len(comp2)
            
            found_op2 = None
            # Search +- 5 elements in comp2
            for i in range(max(0, anchor_list_idx - 5), min(len(comp2), anchor_list_idx + 6)):
                candidate = comp2[i]
                # Check if it's an insert with the same other_token
                if candidate['op_type'] == 'insert' and candidate.get('other_token') == op1.get('other_token'):
                    found_op2 = candidate
                    break
                    
            matched_elements_recall.append({
                'op1': op1['op_type'],
                'op2': found_op2['op_type'] if found_op2 else None,
                'other_token1': op1.get('other_token'),
                'other_token2': found_op2.get('other_token') if found_op2 else None,
                'base_token': None
            })
            
    correct_recall = sum(1 for el in matched_elements_recall if el['op1'] == el['op2'] and el['other_token1'] == el['other_token2'])
    recall = correct_recall / len(matched_elements_recall) if matched_elements_recall else 0.0
    
    matched_elements_prec = []
    
    # 2. Iterate over comp2 to calculate Precision elements
    for op2 in comp2:
        if op2['op_type'] in ('equal', 'delete', 'replace', 'transpose'):
            base_idx = op2['base_idx']
            op1 = comp1_by_base_idx.get(base_idx)
            matched_elements_prec.append({
                'op1': op1['op_type'] if op1 else None,
                'op2': op2['op_type'],
                'other_token1': op1.get('other_token') if op1 else None,
                'other_token2': op2.get('other_token'),
                'base_token': op2.get('base_token')
            })
        elif op2['op_type'] == 'insert':
            base_anchor = int(op2['base_idx'] + 0.5)
            anchor_op1 = comp1_by_base_idx.get(base_anchor)
            anchor_list_idx = anchor_op1['_list_idx'] if anchor_op1 else len(comp1)
            
            found_op1 = None
            # Search +- 5 elements in comp1
            for i in range(max(0, anchor_list_idx - 5), min(len(comp1), anchor_list_idx + 6)):
                candidate = comp1[i]
                if candidate['op_type'] == 'insert' and candidate.get('other_token') == op2.get('other_token'):
                    found_op1 = candidate
                    break
                    
            matched_elements_prec.append({
                'op1': found_op1['op_type'] if found_op1 else None,
                'op2': op2['op_type'],
                'other_token1': found_op1.get('other_token') if found_op1 else None,
                'other_token2': op2.get('other_token'),
                'base_token': None
            })
            
    correct_prec = sum(1 for el in matched_elements_prec if el['op1'] == el['op2'] and el['other_token1'] == el['other_token2'])
    precision = correct_prec / len(matched_elements_prec) if matched_elements_prec else 0.0
    
    return {
        'recall': recall,
        'precision': precision,
        'f1_score': 2 * (recall * precision) / (recall + precision) if (recall + precision) > 0 else 0.0,
        'correct_recall_count': correct_recall,
        'total_recall_count': len(matched_elements_recall),
        'correct_precision_count': correct_prec,
        'total_precision_count': len(matched_elements_prec),
        'recall_elements': matched_elements_recall,
        'precision_elements': matched_elements_prec
    }

def evaluate_files(file1: str, file2: str) -> Dict[str, Any]:
    comp1 = load_ops(file1)
    comp2 = load_ops(file2)
    return evaluate_comparisons(comp1, comp2)
