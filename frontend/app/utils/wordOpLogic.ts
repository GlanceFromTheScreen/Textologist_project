export interface CharOp {
  id: number;
  op_type: 'insert' | 'delete' | 'change';
  from_str: string;
  to_str: string;
  class_id: number | null;
}

export interface WordOp {
  base_index?: number | null;
  other_index?: number | null;
  transpose_parts?: WordOp[] | null;
  id: number;
  op_type: 'equal' | 'insert' | 'delete' | 'replace' | 'transpose';
  base_token: string | null;
  other_token: string | null;
  base_paragraph_index: number | null;
  char_ops: CharOp[];
  class_id?: number | null;
  word_class?: { code: string; display_name: string; color_hex: string; system_key?: 'insignificant' | null } | null;
}

export type EditAction =
  | 'merge_to_transpose'
  | 'split_transpose_to_replacements'

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

export function canTranspose(a: WordOp, b: WordOp): boolean {
  return a.op_type === 'replace' && b.op_type === 'replace' && !!a.base_token && !!b.base_token
    && a.base_token !== b.base_token
    && a.base_token === b.other_token && b.base_token === a.other_token
    && (a.base_index == null || b.base_index == null || b.base_index === a.base_index + 1)
    && (a.other_index == null || b.other_index == null || b.other_index === a.other_index + 1);
}

let nextTemporaryId = -1;

export function getAvailableActions(selectedOps: WordOp[]): EditAction[] {
  if (selectedOps.length === 1) {
    const op = selectedOps[0];
    if (op.op_type === 'transpose') return ['split_transpose_to_replacements'];
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
        return [...(canTranspose(op1, op2) ? ['merge_to_transpose' as EditAction] : []), 'split_re_re_to_ins_re_del', 'split_re_re_to_del_re_ins'];
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
  if (!sortedIndices.length || sortedIndices.some((index, i) => !Number.isInteger(index) || !allOps[index] || (i > 0 && index !== sortedIndices[i-1] + 1))
      || !getAvailableActions(sortedIndices.map(index => allOps[index])).includes(action)) {
    throw new Error('Эта операция недоступна для выбранных соседних элементов');
  }
  
  // Helper to generate a temporary ID (negative to avoid collision with DB ids)
  const generateId = () => nextTemporaryId--;

  if (action === 'merge_to_transpose') {
      const parts = sortedIndices.map(index => allOps[index]);
      const commonClass = (parts[0].class_id ?? null) === (parts[1].class_id ?? null) ? parts[0].class_id ?? null : null;
      newOps.splice(startIdx, 2, {
          id: generateId(), op_type: 'transpose',
          base_token: parts.map(p => p.base_token).join(' '), other_token: parts.map(p => p.other_token).join(' '),
          base_index: parts[0].base_index, other_index: parts[0].other_index,
          base_paragraph_index: parts[0].base_paragraph_index,
          char_ops: [], class_id: commonClass, word_class: commonClass ? parts[0].word_class : null,
          transpose_parts: parts.map(part => ({ ...part, char_ops: part.char_ops.map(char => ({ ...char })) })),
      });
  } else if (action === 'split_transpose_to_replacements') {
      const pair = allOps[startIdx];
      const parts = pair.transpose_parts;
      if (!parts || parts.length !== 2 || !canTranspose(parts[0], parts[1])) throw new Error('Некорректная перестановка');
      const originalClass = (parts[0].class_id ?? null) === (parts[1].class_id ?? null) ? parts[0].class_id ?? null : null;
      const override = (pair.class_id ?? null) !== originalClass;
      newOps.splice(startIdx, 1, ...parts.map(part => ({ ...part, id: generateId(), transpose_parts: undefined,
          char_ops: part.char_ops.map(char => ({ ...char, id: generateId() })),
          ...(override ? { class_id: pair.class_id ?? null, word_class: pair.word_class ?? null } : {}),
      })));
  } else if (action === 'split_replace_to_insert_delete') {
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
        case 'merge_to_transpose': return 'Объединить в перестановку (Tr)';
        case 'split_transpose_to_replacements': return 'Разделить перестановку на замены';
        case 'split_replace_to_insert_delete': return 'Разделить на вставку и удаление';
        case 'split_replace_to_delete_insert': return 'Разделить на удаление и вставку';
        case 'merge_to_replace': return 'Объединить в замену';
        case 'swap_order': return 'Поменять порядок';
        case 'swap_insert_replace': return 'Перестроить замену';
        case 'swap_replace_insert': return 'Перестроить замену';
        case 'swap_delete_replace': return 'Перестроить замену';
        case 'swap_replace_delete': return 'Перестроить замену';
        case 'split_re_re_to_ins_re_del': return 'Преобразовать во вставку, замену и удаление';
        case 'split_re_re_to_del_re_ins': return 'Преобразовать в удаление, замену и вставку';
        default: return action;
    }
}
