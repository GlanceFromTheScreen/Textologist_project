import unittest
from pydantic import ValidationError
import algo
from backend import models, schemas, utils_text
from backend.routers.comparisons import execute_comparison, read_comparison, save_comparison
from backend.routers.matrix import run_matrix
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase


class TokenizerSeparatorTests(unittest.TestCase):
    def test_default_splits_only_literal_space(self):
        result=algo.tokenize_paragraphs([' один  два,три\tчетыре\u00a0пять '])
        self.assertEqual(result.tokens,['один','два,три\tчетыре\u00a0пять'])

    def test_custom_punctuation_and_paragraph_indices(self):
        result=algo.tokenize_paragraphs([',один,,два;','', ';три;четыре,'],[',',';'])
        self.assertEqual(result.tokens,['один','два','три','четыре'])
        self.assertEqual(result.token_paragraph_index,[0,0,2,2])

    def test_regex_metacharacters_and_unicode_are_literal(self):
        chars=['[',']','-','\\','^','.','🙂']
        for separator in chars:
            with self.subTest(separator=separator):
                self.assertEqual(algo.tokenize_paragraphs([f'a{separator}b'],[separator]).tokens,['a','b'])
        self.assertEqual(algo.tokenize_paragraphs(['а🙂б🙂'],['🙂']).tokens,['а','б'])

    def test_spaces_and_tabs_remain_when_not_selected(self):
        self.assertEqual(algo.tokenize_paragraphs(['a b, c\td'],[',']).tokens,['a b',' c\td'])
        self.assertEqual(algo.tokenize_paragraphs(['a\tb\u00a0c'],['\t','\u00a0']).tokens,['a','b','c'])
        self.assertEqual(algo.tokenize_paragraphs(['a, ,b'],[',']).tokens,['a',' ','b'])

    def test_repeated_delimiters_empty_input_and_duplicate_selection(self):
        self.assertEqual(algo.tokenize_paragraphs([',,', ''],[',',',']).tokens,[])
        self.assertEqual(algo.tokenize_paragraphs([],[' ']).tokens,[])
        self.assertEqual(schemas.TokenizationSettings(separators=[' ','.',' ']).separators,[' ','.'])

    def test_invalid_separator_sets_are_rejected_at_algorithm_and_api_schema(self):
        for value in [[],[''],['ab'],[1],[' ',None],' ,']:
            with self.subTest(value=value):
                with self.assertRaises(ValueError): algo.tokenize_paragraphs(['text'],value)
                with self.assertRaises(ValidationError): schemas.ComparisonCreate(base_text_id=1,other_text_id=2,weights=schemas.Weights(),separators=value)
                with self.assertRaises(ValidationError): schemas.DistanceMatrixRequest(text_ids=[1,2],weights=schemas.Weights(),separators=value)
        with self.assertRaises(ValidationError): schemas.TokenizationSettings(separators=None)

    def test_text_upload_preserves_unselected_characters(self):
        self.assertEqual(utils_text.extract_paragraphs_txt(' a\tb \r\n c,d '.encode()),[' a\tb ', ' c,d '])


class ComparisonSeparatorTests(ComparisonDatabaseTestCase):
    def run_pair(self, old, new, separators=None, algorithm='levenshtein'):
        texts=[]
        for content in [old,new]:
            text=models.TextModel(owner_user_id=self.user.id,title='Separator test',source_type=models.SourceType.txt,file_path='',extracted_paragraphs_json=[content])
            self.db.add(text);self.db.flush();texts.append(text)
        params=dict(base_text_id=texts[0].id,other_text_id=texts[1].id,weights=schemas.Weights(),algorithm=algorithm)
        if separators is not None:params['separators']=separators
        comp=execute_comparison(self.db,self.user,schemas.ComparisonCreate(**params))
        return read_comparison(comp.id,self.user,self.db)

    def test_all_algorithms_apply_and_persist_selected_separators(self):
        for algorithm in ['levenshtein','levenshtein_nested','levenshtein_v2','myers']:
            with self.subTest(algorithm=algorithm):
                comp=self.run_pair('а,б;в','а;б,г',[',',';'],algorithm)
                self.assertEqual(comp.separators,[',',';'])
                self.assertEqual([w.base_token for w in comp.word_ops if w.base_token is not None],['а','б','в'])
                self.assertEqual([w.other_token for w in comp.word_ops if w.other_token is not None],['а','б','г'])
                save_comparison(comp.id,schemas.ComparisonSaveRequest(word_ops=comp.model_dump()['word_ops']),self.user,self.db)
                self.assertEqual(read_comparison(comp.id,self.user,self.db).separators,[',',';'])

    def test_default_keeps_punctuation_and_matrix_uses_same_settings(self):
        comp=self.run_pair('а,б','а;б')
        self.assertEqual(comp.separators,[' ']);self.assertEqual(len(comp.word_ops),1)
        matrix=run_matrix(schemas.DistanceMatrixRequest(text_ids=[comp.base_text_id,comp.other_text_id],weights=schemas.Weights(),separators=[',',';']),self.user,self.db)
        self.assertEqual(matrix.matrix,[[0,0],[0,0]])
        default=run_matrix(schemas.DistanceMatrixRequest(text_ids=[comp.base_text_id,comp.other_text_id],weights=schemas.Weights()),self.user,self.db)
        self.assertGreater(default.matrix[0][1],0)

    def test_transpositions_with_space_inside_tokens_round_trip(self):
        comp=self.run_pair('a b,c d','c d,a b',[','])
        self.assertEqual(comp.word_ops[0].op_type,'transpose')
        self.assertEqual([p.base_token for p in comp.word_ops[0].transpose_parts],['a b','c d'])
        payload={'format':'textologist-comparison-v2','separators':comp.separators,'word_ops':comp.model_dump(mode='json')['word_ops']}
        imported=self.upload(payload)
        self.assertEqual(imported.separators,[','])
        for text_id,expected in [(imported.base_text_id,['a b','c d']),(imported.other_text_id,['c d','a b'])]:
            text=self.db.get(models.TextModel,text_id)
            self.assertEqual(algo.tokenize_paragraphs(text.extracted_paragraphs_json,imported.separators).tokens,expected)
        save_comparison(imported.id,schemas.ComparisonSaveRequest(word_ops=imported.model_dump()['word_ops']),self.user,self.db)

    def test_invalid_import_metadata_rejected_without_new_rows(self):
        from fastapi import HTTPException
        before=self.db.query(models.Comparison).count()
        for separators in [[],[''],['ab']]:
            with self.assertRaises(HTTPException):self.upload({'format':'textologist-comparison-v2','separators':separators,'word_ops':[dict(op_type='equal',base_token='a',other_token='a')]})
        self.assertEqual(self.db.query(models.Comparison).count(),before)
