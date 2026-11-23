from copy import deepcopy
import json
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from backend import models, schemas
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase
from backend.routers.comparisons import execute_comparison, read_comparison, save_comparison, update_word_op
from backend.routers.stats import get_comparison_stats
from backend.routers.matrix import run_matrix
from backend.reconstructed_texts import reconstruct_paragraphs

PAIR = dict(op_type='transpose', base_token='дьни вѣка', other_token='вѣка дьни', base_index=0,other_index=0,base_paragraph_index=0,
    char_ops=[], class_id=10, word_class=dict(code='pair',display_name='Порядок слов',color_hex='#8b5cf6'),
    transpose_parts=[
        dict(op_type='replace',base_token='дьни',other_token='вѣка',base_index=0,other_index=0,base_paragraph_index=0,class_id=20,
             word_class=dict(code='old',display_name='Исходная разметка',color_hex='#123456'),char_ops=[dict(op_type='change',from_str='д',to_str='в',class_id=30)]),
        dict(op_type='replace',base_token='вѣка',other_token='дьни',base_index=1,other_index=1,base_paragraph_index=0,char_ops=[],class_id=None),
    ])


class TranspositionStorageTests(ComparisonDatabaseTestCase):
    def test_import_save_export_preserves_parts_and_remaps_all_classes(self):
        comp = self.upload([PAIR])
        word = comp.word_ops[0]
        self.assertEqual(word.op_type, 'transpose')
        self.assertEqual(word.word_class.display_name, 'Порядок слов')
        self.assertNotEqual(word.class_id, word.transpose_parts[0].class_id)
        self.assertEqual(word.transpose_parts[0].word_class.display_name, 'Исходная разметка')
        character_class = self.db.get(models.ClassCatalog, word.transpose_parts[0].char_ops[0].class_id)
        self.assertEqual(character_class.kind, 'char')
        self.assertEqual(self.db.get(models.TextModel, comp.base_text_id).extracted_paragraphs_json, ['дьни вѣка'])
        self.assertEqual(self.db.get(models.TextModel, comp.other_text_id).extracted_paragraphs_json, ['вѣка дьни'])
        save_comparison(comp.id, schemas.ComparisonSaveRequest(word_ops=comp.model_dump()['word_ops']), self.user, self.db)
        saved = read_comparison(comp.id, self.user, self.db)
        self.assertEqual(saved.word_ops[0].transpose_parts, word.transpose_parts)
        imported = self.upload(saved.model_dump(mode='json')['word_ops'])
        self.assertEqual(imported.word_ops[0].transpose_parts[0].word_class.display_name, 'Исходная разметка')
        self.assertEqual(get_comparison_stats(comp.id, self.user, self.db).totals.transpose, 1)
        self.assertEqual(get_comparison_stats(comp.id, self.user, self.db).totals.replace, 0)

    def test_shared_class_changes_do_not_destroy_character_annotations(self):
        comp = self.upload([PAIR]); word = comp.word_ops[0]
        builtin = self.db.query(models.ClassCatalog).filter_by(system_key='insignificant').one()
        hidden = update_word_op(word.id, schemas.WordClassUpdate(class_id=builtin.id), self.user, self.db)
        self.assertEqual(hidden.transpose_parts, word.transpose_parts)
        self.assertEqual(hidden.word_class.system_key, 'insignificant')
        restored = update_word_op(word.id, schemas.WordClassUpdate(class_id=None), self.user, self.db)
        self.assertEqual(restored.transpose_parts, word.transpose_parts)

    def test_invalid_transpositions_are_rejected_without_saving(self):
        mutations = [lambda w:w.update(transpose_parts=None), lambda w:w['transpose_parts'].pop(),
                     lambda w:w['transpose_parts'][1].update(other_token='Дьни'),
                     lambda w:w['transpose_parts'][1].update(base_index=2),
                     lambda w:w.update(base_token='wrong'),
                     lambda w:w.update(op_type='replace'),
                     lambda w:w.update(char_ops=[dict(op_type='change',from_str='a',to_str='b')])]
        for mutate in mutations:
            payload = deepcopy(PAIR); mutate(payload)
            with self.assertRaises(HTTPException): self.upload([payload])
        self.assertEqual(self.db.query(models.Comparison).filter_by(owner_user_id=self.user.id).count(),0)

    def test_save_validates_preserved_private_word_and_character_classes(self):
        comp = self.upload([PAIR]); before = read_comparison(comp.id,self.user,self.db)
        foreign = models.ClassCatalog(owner_user_id=self.other_user.id,code='foreign',display_name='Foreign',color_hex='#000000',kind='word')
        self.db.add(foreign); self.db.flush()
        for target in ['word','char']:
            payload = before.model_dump()['word_ops']
            part = payload[0]['transpose_parts'][0]
            if target == 'word': part['class_id'] = foreign.id
            else: part['char_ops'][0]['class_id'] = foreign.id
            with self.assertRaises(HTTPException):
                save_comparison(comp.id,schemas.ComparisonSaveRequest(word_ops=payload),self.user,self.db)
        self.assertEqual(read_comparison(comp.id,self.user,self.db).word_ops[0].id,before.word_ops[0].id)

    def test_cross_paragraph_reconstruction_retains_boundaries(self):
        payload = deepcopy(PAIR); payload['transpose_parts'][1]['base_paragraph_index']=1
        op = schemas.ImportedWordOp(**payload)
        self.assertEqual(reconstruct_paragraphs([op]), (['дьни','вѣка'], ['вѣка','дьни']))

    def test_run_all_algorithms_and_matrix_on_existing_text_example(self):
        case=json.loads((Path(__file__).parent/'fixtures/transposition_examples.json').read_text())['examples'][0]
        texts=[]
        for side in ['base','other']:
            text=models.TextModel(owner_user_id=self.user.id,title='Transpose fixture '+side,source_type=models.SourceType.txt,file_path='',extracted_paragraphs_json=[' '.join(case[side])])
            self.db.add(text);self.db.flush();texts.append(text)
        for algorithm in ['levenshtein','levenshtein_nested','levenshtein_v2']:
            comp=execute_comparison(self.db,self.user,schemas.ComparisonCreate(base_text_id=texts[0].id,other_text_id=texts[1].id,weights=schemas.Weights(),algorithm=algorithm))
            detail=read_comparison(comp.id,self.user,self.db)
            pairs=[word for word in detail.word_ops if word.op_type=='transpose']
            self.assertEqual(len(pairs),1)
            schemas.ComparisonSaveRequest(word_ops=detail.model_dump()['word_ops'])
            matrix=run_matrix(schemas.DistanceMatrixRequest(text_ids=[text.id for text in texts],weights=schemas.Weights(),algorithm=algorithm),self.user,self.db)
            self.assertGreater(matrix.matrix[0][1],0)
            self.assertEqual(matrix.matrix[0][0],0)
