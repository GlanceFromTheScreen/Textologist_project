// Run after compiling wordOpLogic.ts to /tmp/textologist-word-logic in the build image.
const assert = require('node:assert/strict');
const { applyAction, getAvailableActions } = require('/tmp/textologist-word-logic/wordOpLogic.js');
const part = (id, old, newer, cls) => ({id,op_type:'replace',base_token:old,other_token:newer,base_paragraph_index:0,class_id:cls,
  char_ops:[{id:id*10,op_type:'change',from_str:old,to_str:newer,class_id:7}]});
const base = [part(1,'дьни','вѣка',5),part(2,'вѣка','дьни',6)];
const streams = ops => ['base','other'].map(side => ops.flatMap(op => op.transpose_parts || [op]).map(op => op[side+'_token']).filter(Boolean));
assert.ok(getAvailableActions(base).includes('merge_to_transpose'));
const pair = applyAction(base,[0,1],'merge_to_transpose');
assert.equal(pair.length,1); assert.equal(pair[0].op_type,'transpose'); assert.equal(pair[0].class_id,null);
assert.deepEqual(streams(pair),streams(base));
const split = applyAction(pair,[0],'split_transpose_to_replacements');
assert.deepEqual(streams(split),streams(base));
assert.deepEqual(split.map(w=>w.class_id),[5,6]);
assert.deepEqual(split.map(w=>w.char_ops[0].class_id),[7,7]);
const assigned = [{...pair[0],class_id:9,word_class:{code:'shared',display_name:'Shared',color_hex:'#123456'}}];
const sharedSplit = applyAction(assigned,[0],'split_transpose_to_replacements');
assert.deepEqual(sharedSplit.map(w=>w.class_id),[9,9]);
assert.equal(applyAction(sharedSplit,[0,1],'merge_to_transpose')[0].class_id,9);
assert.throws(()=>applyAction([...base,part(3,'x','y',null)],[0,2],'merge_to_transpose'));
assert.throws(()=>applyAction(base,[0,0],'merge_to_transpose'));
assert.ok(!getAvailableActions([base[0],part(3,'вѣка','Дьни',null)]).includes('merge_to_transpose'));
assert.ok(!getAvailableActions([part(1,'a','a',null),part(2,'a','a',null)]).includes('merge_to_transpose'));
assert.ok(!getAvailableActions([{...base[0],base_index:0},{...base[1],base_index:2}]).includes('merge_to_transpose'));
for (let step=0, ops=base; step<20; step++) {
  ops=applyAction(ops,ops.length===2?[0,1]:[0],ops.length===2?'merge_to_transpose':'split_transpose_to_replacements');
  assert.deepEqual(streams(ops),streams(base));
}
console.log('Transposition state-machine checks passed: adjacency, exact match, token streams, reversible classes/character annotations, repeated round trips.');

const phrases = [part(21,'a  b','c\td',null),part(22,'c\td','a  b',null)];
assert.ok(getAvailableActions(phrases).includes('merge_to_transpose'));
const phrasePair = applyAction(phrases,[0,1],'merge_to_transpose');
assert.deepEqual(streams(phrasePair), streams(phrases));
assert.deepEqual(streams(applyAction(phrasePair,[0],'split_transpose_to_replacements')), streams(phrases));
console.log('Custom separators: phrase tokens preserve spaces/tabs through transposition round trips.');
