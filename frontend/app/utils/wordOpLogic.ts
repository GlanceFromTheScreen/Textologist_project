export interface CharOp {
  id: number;
  op_type: 'insert' | 'delete' | 'change';
  from_str: string;
  to_str: string;
  class_id: number | null;
}

export interface WordOp {
  id: number;
  op_type: 'equal' | 'insert' | 'delete' | 'replace';
  base_token: string | null;
  other_token: string | null;
  base_paragraph_index: number | null;
  char_ops: CharOp[];
}

export type EditAction = 
  | 'split_replace_to_insert_delete'
  | 'split_replace_to_delete_insert'
  | 'merge_to_replace'
  | 'swap_order'
  | 'swap_replace_insert' // re, + -> +, re
  | 'swap_insert_replace' // +, re -> re, +
  | 'swap_replace_delete' // re, - -> -, re
  | 'swap_delete_replace' // -, re -> re, -
  | 'split_re_re_to_ins_re_del'
  | 'split_re_re_to_del_re_ins';

export function getAvailableActions(selectedOps: WordOp[]): EditAction[] {
  if (selectedOps.length === 1) {
    const op = selectedOps[0];
    if (op.op_type === 'replace') {
      return ['split_replace_to_insert_delete', 'split_replace_to_delete_insert'];
    }
  } else if (selectedOps.length === 2) {
    const [op1, op2] = selectedOps;
    const type1 = op1.op_type;
    const type2 = op2.op_type;

    if (type1 === 'insert' && type2 === 'delete') {
      return ['merge_to_replace', 'swap_order']; // (+, -) -> (re) or (-, +)
    }
    if (type1 === 'delete' && type2 === 'insert') {
      return ['merge_to_replace', 'swap_order']; // (-, +) -> (re) or (+, -)
    }
    
    if (type1 === 'insert' && type2 === 'replace') {
       return ['swap_insert_replace']; // (+, re) -> (re, +)
    }
    if (type1 === 'replace' && type2 === 'insert') {
       return ['swap_replace_insert']; // (re, +) -> (+, re)
    }
    
    if (type1 === 'delete' && type2 === 'replace') {
        return ['swap_delete_replace']; // (-, re) -> (re, -)
    }
    if (type1 === 'replace' && type2 === 'delete') {
        return ['swap_replace_delete']; // (re, -) -> (-, re)
    }

    if (type1 === 'replace' && type2 === 'replace') {
        return ['split_re_re_to_ins_re_del', 'split_re_re_to_del_re_ins'];
    }
  }
  return [];
}

export function applyAction(
  allOps: WordOp[], 
  selectedIndices: number[], 
  action: EditAction
): WordOp[] {
  const newOps = [...allOps];
  // Sort indices to ensure we handle them in order
  const sortedIndices = [...selectedIndices].sort((a, b) => a - b);
  const startIdx = sortedIndices[0];
  
  // Helper to generate a temporary ID (negative to avoid collision with DB ids)
  const generateId = () => -Math.floor(Math.random() * 1000000);

  if (action === 'split_replace_to_insert_delete') {
      // replace -> insert, delete
      const op = allOps[startIdx];
      
      const insertOp: WordOp = {
          id: generateId(),
          op_type: 'insert',
          base_token: null,
          other_token: op.other_token,
          base_paragraph_index: op.base_paragraph_index, 
          char_ops: []
      };
      
      const deleteOp: WordOp = {
          id: generateId(),
          op_type: 'delete',
          base_token: op.base_token,
          other_token: null,
          base_paragraph_index: op.base_paragraph_index,
          char_ops: []
      };
      
      newOps.splice(startIdx, 1, insertOp, deleteOp);
      
  } else if (action === 'split_replace_to_delete_insert') {
      const op = allOps[startIdx];
      
      const deleteOp: WordOp = {
          id: generateId(),
          op_type: 'delete',
          base_token: op.base_token,
          other_token: null,
          base_paragraph_index: op.base_paragraph_index,
          char_ops: []
      };
      
      const insertOp: WordOp = {
          id: generateId(),
          op_type: 'insert',
          base_token: null,
          other_token: op.other_token,
          base_paragraph_index: op.base_paragraph_index,
          char_ops: []
      };
      
      newOps.splice(startIdx, 1, deleteOp, insertOp);
      
  } else if (action === 'merge_to_replace') {
      // insert + delete OR delete + insert -> replace
      const op1 = allOps[sortedIndices[0]];
      const op2 = allOps[sortedIndices[1]];
      
      const deleteOp = op1.op_type === 'delete' ? op1 : op2;
      const insertOp = op1.op_type === 'insert' ? op1 : op2;
      
      const replaceOp: WordOp = {
          id: generateId(),
          op_type: 'replace',
          base_token: deleteOp.base_token,
          other_token: insertOp.other_token,
          base_paragraph_index: deleteOp.base_paragraph_index,
          char_ops: [] 
      };
      
      newOps.splice(startIdx, 2, replaceOp);
      
  } else if (action === 'swap_order') {
      const op1 = allOps[sortedIndices[0]];
      const op2 = allOps[sortedIndices[1]];
      newOps.splice(startIdx, 2, op2, op1);
      
  } else if (['swap_replace_insert', 'swap_insert_replace', 'swap_delete_replace', 'swap_replace_delete'].includes(action)) {
      const op1 = allOps[sortedIndices[0]];
      const op2 = allOps[sortedIndices[1]];
      
      // We are swapping the operation types while preserving the sequence of base and other tokens.
      
      // 1. Collect all base tokens (and para indices) in order
      const baseTokens: {token: string, para: number | null}[] = [];
      if (op1.op_type === 'replace' || op1.op_type === 'delete') {
          if (op1.base_token) baseTokens.push({token: op1.base_token, para: op1.base_paragraph_index});
      }
      if (op2.op_type === 'replace' || op2.op_type === 'delete') {
          if (op2.base_token) baseTokens.push({token: op2.base_token, para: op2.base_paragraph_index});
      }
      
      // 2. Collect all other tokens in order
      const otherTokens: string[] = [];
      if (op1.op_type === 'replace' || op1.op_type === 'insert') {
          if (op1.other_token) otherTokens.push(op1.other_token);
      }
      if (op2.op_type === 'replace' || op2.op_type === 'insert') {
          if (op2.other_token) otherTokens.push(op2.other_token);
      }
      
      // 3. Determine new types
      let type1: 'insert' | 'delete' | 'replace';
      let type2: 'insert' | 'delete' | 'replace';
      
      if (action === 'swap_insert_replace') { // (+, re) -> (re, +)
          type1 = 'replace'; type2 = 'insert';
      } else if (action === 'swap_replace_insert') { // (re, +) -> (+, re)
          type1 = 'insert'; type2 = 'replace';
      } else if (action === 'swap_delete_replace') { // (-, re) -> (re, -)
          type1 = 'replace'; type2 = 'delete';
      } else { // swap_replace_delete (re, -) -> (-, re)
          type1 = 'delete'; type2 = 'replace';
      }
      
      // 4. Construct new ops
      const constructOp = (type: 'insert' | 'delete' | 'replace'): WordOp => {
          const op: WordOp = {
              id: generateId(),
              op_type: type,
              base_token: null,
              other_token: null,
              base_paragraph_index: null,
              char_ops: []
          };
          
          if (type === 'replace' || type === 'delete') {
              const base = baseTokens.shift();
              if (base) {
                  op.base_token = base.token;
                  op.base_paragraph_index = base.para;
              }
          }
          
          if (type === 'replace' || type === 'insert') {
              const other = otherTokens.shift();
              if (other) {
                  op.other_token = other;
              }
          }
          
          // Fallback para index
          if (op.base_paragraph_index === null) {
              op.base_paragraph_index = op1.base_paragraph_index;
          }
          
          return op;
      };
      
      const newOp1 = constructOp(type1);
      const newOp2 = constructOp(type2);
      
      newOps.splice(startIdx, 2, newOp1, newOp2);
      
  } else if (action === 'split_re_re_to_ins_re_del') {
      // (+, re, -) -> Insert(other1), Replace(base1 -> other2), Delete(base2)
      const re1 = allOps[sortedIndices[0]];
      const re2 = allOps[sortedIndices[1]];
      
      const ins: WordOp = { 
        id: generateId(), 
        op_type: 'insert', 
        base_token: null, 
        other_token: re1.other_token, 
        base_paragraph_index: re1.base_paragraph_index, 
        char_ops: [] 
      };
      const re: WordOp = { 
        id: generateId(), 
        op_type: 'replace', 
        base_token: re1.base_token, 
        other_token: re2.other_token, 
        base_paragraph_index: re1.base_paragraph_index, 
        char_ops: [] 
      };
      const del: WordOp = { 
        id: generateId(), 
        op_type: 'delete', 
        base_token: re2.base_token, 
        other_token: null, 
        base_paragraph_index: re2.base_paragraph_index, 
        char_ops: [] 
      };
      
      newOps.splice(startIdx, 2, ins, re, del);
      
  } else if (action === 'split_re_re_to_del_re_ins') {
      // (-, re, +) -> Delete(base1), Replace(base2 -> other1), Insert(other2)
      const re1 = allOps[sortedIndices[0]];
      const re2 = allOps[sortedIndices[1]];

      const del: WordOp = { 
        id: generateId(), 
        op_type: 'delete', 
        base_token: re1.base_token, 
        other_token: null, 
        base_paragraph_index: re1.base_paragraph_index, 
        char_ops: [] 
      };
      const re: WordOp = { 
        id: generateId(), 
        op_type: 'replace', 
        base_token: re2.base_token, 
        other_token: re1.other_token, 
        base_paragraph_index: re2.base_paragraph_index, 
        char_ops: [] 
      };
      const ins: WordOp = { 
        id: generateId(), 
        op_type: 'insert', 
        base_token: null, 
        other_token: re2.other_token, 
        base_paragraph_index: re2.base_paragraph_index, 
        char_ops: [] 
      };

      newOps.splice(startIdx, 2, del, re, ins);
  }

  return newOps;
}

export function getActionLabel(action: EditAction): string {
    switch (action) {
        case 'split_replace_to_insert_delete': return 'Split to Insert + Delete';
        case 'split_replace_to_delete_insert': return 'Split to Delete + Insert';
        case 'merge_to_replace': return 'Merge to Replace';
        case 'swap_order': return 'Swap Order';
        case 'swap_insert_replace': return 'Swap Replace';
        case 'swap_replace_insert': return 'Swap Replace';
        case 'swap_delete_replace': return 'Swap Replace';
        case 'swap_replace_delete': return 'Swap Replace';
        case 'split_re_re_to_ins_re_del': return 'Transform to Ins, Rep, Del';
        case 'split_re_re_to_del_re_ins': return 'Transform to Del, Rep, Ins';
        default: return action;
    }
}
