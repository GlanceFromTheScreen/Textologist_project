"""Preset semantics exercised through real comparison/save/edit endpoints."""
from types import SimpleNamespace
from fastapi import HTTPException
from backend import models, schemas
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase
from backend.tests.test_transposition_storage import PAIR
from backend.routers.comparisons import execute_comparison, save_as_preset, read_comparison
from backend.routers.presets import delete_rule, restore_rule, read_preset
from backend.preset_matching import PresetMatcher, collect_preset_rules


class ContextualPresetTests(ComparisonDatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.char_class = models.ClassCatalog(owner_user_id=self.user.id, code='char', display_name='Буквы', color_hex='#123456', kind='char')
        self.word_class = models.ClassCatalog(owner_user_id=self.user.id, code='word', display_name='Слова', color_hex='#abcdef', kind='word')
        self.db.add_all([self.char_class, self.word_class]); self.db.flush()

    def run_pair(self, old, new, preset_id=None, algorithm='levenshtein'):
        texts=[]
        for content in [old,new]:
            text=models.TextModel(owner_user_id=self.user.id, title='Preset test',source_type=models.SourceType.txt,file_path='',extracted_paragraphs_json=[content])
            self.db.add(text); self.db.flush(); texts.append(text)
        result=execute_comparison(self.db,self.user,schemas.ComparisonCreate(base_text_id=texts[0].id,other_text_id=texts[1].id,preset_id=preset_id,algorithm=algorithm,weights=schemas.Weights()))
        self.db.refresh(result)
        return result

    def source_preset(self, old='мама', new='мому'):
        comp=self.run_pair(old,new)
        for word in comp.word_ops:
            if word.op_type != models.WordOpType.equal: word.class_id=self.word_class.id
            for char in word.char_ops: char.class_id=self.char_class.id
        self.db.commit()
        return save_as_preset(comp.id,schemas.SaveAsPresetRequest(name='Контекст'),self.user,self.db)

    def test_save_both_kinds_with_context_and_no_unclassified_rules(self):
        preset=self.source_preset()
        serialized=schemas.PresetRead.model_validate(preset)
        char=[r for r in serialized.rules if r.kind=='char']; words=[r for r in serialized.rules if r.kind=='word']
        self.assertEqual(len(char),2); self.assertEqual(len(words),1)
        self.assertTrue(all({r.base_word,r.other_word}=={'мама','мому'} for r in char))
        self.assertTrue(all(r.class_id==self.char_class.id for r in char))
        self.assertEqual(words[0].class_id,self.word_class.id)
        plain=self.run_pair('кот','кит')
        empty=save_as_preset(plain.id,schemas.SaveAsPresetRequest(name='Empty'),self.user,self.db)
        self.assertEqual(empty.rules,[])

    def test_both_directions_apply_character_and_word_classes_all_algorithms(self):
        preset=self.source_preset('вѣка','века')
        for algorithm in ['levenshtein','levenshtein_nested','levenshtein_v2']:
            for old,new in [('вѣка','века'),('века','вѣка')]:
                with self.subTest(algorithm=algorithm,old=old):
                    comp=self.run_pair(old,new,preset.id,algorithm)
                    self.assertEqual(comp.word_ops[0].class_id,self.word_class.id)
                    self.assertEqual(len(comp.char_ops),1)
                    self.assertEqual(comp.char_ops[0].class_id,self.char_class.id)
                    self.assertEqual(comp.char_ops[0].source,models.CharOpSource.preset)

    def test_one_context_word_is_enough_from_either_side(self):
        preset=self.source_preset('вѣка','векъ')
        for old,new in [('вѣка','века'),('века','вѣка'),('векъ','вѣкъ'),('вѣкъ','векъ')]:
            with self.subTest(old=old,new=new):
                comp=self.run_pair(old,new,preset.id)
                self.assertTrue(comp.char_ops)
                self.assertTrue(all(c.class_id==self.char_class.id for c in comp.char_ops))
                self.assertIsNone(comp.word_ops[0].class_id) # Word rules require the complete pair.

    def test_no_global_substring_case_or_unicode_context_matching(self):
        preset=self.source_preset()
        for old,new in [('папа','попа'),('мамам','момам'),('МАМА','МОМА'),('мама','мима')]:
            comp=self.run_pair(old,new,preset.id)
            self.assertTrue(comp.char_ops)
            self.assertTrue(all(c.class_id is None for c in comp.char_ops))
        # No preset selected, no propagation at all.
        self.assertIsNone(self.run_pair('мама','мому').char_ops[0].class_id)

    def test_insert_and_delete_are_inverse_character_rules(self):
        preset=self.source_preset('дьни','дни')
        forward=self.run_pair('дьни','дни',preset.id)
        backward=self.run_pair('дни','дьни',preset.id)
        self.assertEqual(forward.char_ops[0].op_type,models.OpType.delete)
        self.assertEqual(backward.char_ops[0].op_type,models.OpType.insert)
        self.assertEqual(backward.char_ops[0].class_id,self.char_class.id)
        self.assertEqual(backward.word_ops[0].class_id,self.word_class.id)

    def test_word_insert_delete_and_transpose_classes_are_bidirectional(self):
        for old,new in [('кот','кот дом'),('дьни вѣка','вѣка дьни')]:
            preset=self.source_preset(old,new)
            backward=self.run_pair(new,old,preset.id)
            changed=[w for w in backward.word_ops if w.op_type != models.WordOpType.equal]
            self.assertEqual(len(changed),1)
            self.assertEqual(changed[0].class_id,self.word_class.id)

    def test_legacy_contextless_rules_are_preserved_but_never_applied(self):
        preset=models.Preset(owner_user_id=self.user.id,name='Legacy'); self.db.add(preset); self.db.flush()
        self.db.add(models.PresetRule(preset_id=preset.id,op_type='change',from_str='а',to_str='о',class_id=self.char_class.id))
        self.db.commit()
        self.assertEqual(len(read_preset(preset.id,self.user,self.db).rules),1)
        self.assertIsNone(self.run_pair('мама','мома',preset.id).char_ops[0].class_id)
        self.assertIsNone(self.run_pair('мома','мама',preset.id).char_ops[0].class_id)

    def test_deleting_one_rule_updates_future_results_and_restore_works(self):
        preset=self.source_preset('вѣка','века')
        char_rule=next(r for r in preset.rules if r.kind=='char')
        word_rule=next(r for r in preset.rules if r.kind=='word')
        original=self.run_pair('вѣка','века',preset.id)
        delete_rule(preset.id,char_rule.id,self.user,self.db)
        deleted=self.run_pair('века','вѣка',preset.id)
        self.assertIsNone(deleted.char_ops[0].class_id)
        self.assertEqual(deleted.word_ops[0].class_id,self.word_class.id)
        self.assertEqual(read_comparison(original.id,self.user,self.db).word_ops[0].char_ops[0].class_id,self.char_class.id)
        restore_rule(preset.id,char_rule.id,self.user,self.db)
        delete_rule(preset.id,word_rule.id,self.user,self.db)
        restored=self.run_pair('века','вѣка',preset.id)
        self.assertEqual(restored.char_ops[0].class_id,self.char_class.id)
        self.assertIsNone(restored.word_ops[0].class_id)

    def test_ownership_and_rule_preset_scope(self):
        preset=self.source_preset('вѣка','века'); rule=preset.rules[0]
        for endpoint in [delete_rule,restore_rule]:
            with self.assertRaises(HTTPException): endpoint(preset.id,rule.id,self.other_user,self.db)
            with self.assertRaises(HTTPException): endpoint(preset.id+100000,rule.id,self.user,self.db)
        foreign=models.Preset(owner_user_id=self.other_user.id,name='Foreign'); self.db.add(foreign);self.db.flush()
        for preset_id in [foreign.id,foreign.id+100000]:
            with self.assertRaises(HTTPException): self.run_pair('вѣка','века',preset_id)
        self.assertFalse(rule.is_deleted)

    def test_transpose_preserves_character_context_rules_in_hidden_parts(self):
        comp=self.upload([PAIR])
        preset=save_as_preset(comp.id,schemas.SaveAsPresetRequest(name='Hidden'),self.user,self.db)
        chars=[r for r in preset.rules if r.kind=='char']; words=[r for r in preset.rules if r.kind=='word']
        self.assertEqual(len(chars),1); self.assertEqual(len(words),1)
        self.assertEqual({chars[0].base_word,chars[0].other_word},{'дьни','вѣка'})
        backward=self.run_pair('вѣка дьни','дьни вѣка',preset.id)
        self.assertEqual(backward.word_ops[0].class_id,words[0].class_id)
        snapshots=backward.word_ops[0].transpose_parts
        matches=[c for part in snapshots for c in part['char_ops'] if {c['from_str'],c['to_str']}=={'д','в'}]
        self.assertTrue(matches)
        self.assertTrue(all(c['class_id']==chars[0].class_id for c in matches))

    def test_dedup_inverse_rules_and_exact_context_priority(self):
        classes={1:SimpleNamespace(kind='char',display_name='A'),2:SimpleNamespace(kind='char',display_name='Z'),3:SimpleNamespace(kind='word',display_name='Word')}
        words=[dict(op_type='replace',base_token=a,other_token=b,class_id=3,char_ops=[dict(op_type='change',from_str=x,to_str=y,class_id=2)]) for a,b,x,y in [('cat','cot','a','o'),('cot','cat','o','a')]]
        rules=collect_preset_rules(words,classes)
        self.assertEqual(len(rules),2)
        rules.append(dict(kind='char',op_type='change',from_str='a',to_str='o',base_word='cat',other_word='coat',class_id=1))
        matcher=PresetMatcher(rules,classes)
        self.assertEqual(matcher.character('change','o','a','cot','cat'),2)
        self.assertEqual(matcher.character('change','a','o','cat','coat'),1)
        self.assertIsNone(matcher.character('change','a','o','pat','pot'))
        self.assertEqual(matcher.word('replace','cot','cat'),3)
