"""Word classifications: isolation, persistence, legacy JSON and portable metadata."""
from copy import deepcopy

from fastapi import HTTPException
from pydantic import ValidationError

from backend import models, schemas
from backend.routers.classes import create_class, read_classes
from backend.routers.comparisons import (
    read_comparison, save_comparison, update_word_op, update_char_op, update_char_op_group,
)
from backend.tests.test_comparison_import import ComparisonDatabaseTestCase, OPERATIONS


class WordClassTests(ComparisonDatabaseTestCase):
    def make_class(self, kind="word", owner=None):
        return create_class(schemas.ClassCreate(display_name="Лексическая замена", color_hex="#8b5cf6", kind=kind), owner or self.user, self.db)

    def assign(self, word, cls, user=None):
        return update_word_op(word.id, schemas.WordClassUpdate(class_id=cls.id if cls else None), user or self.user, self.db)

    def test_legacy_import_defaults_to_no_word_class_and_preserves_character_classes(self):
        comp = self.upload(OPERATIONS)
        self.assertTrue(all(w.class_id is None and w.word_class is None for w in comp.word_ops))
        char_class = self.db.get(models.ClassCatalog, comp.word_ops[0].char_ops[0].class_id)
        self.assertEqual(char_class.kind, "char")

    def test_create_and_list_separate_kinds_with_default_character_kind(self):
        word = self.make_class()
        char = create_class(schemas.ClassCreate(code="typo", display_name="Опечатка", color_hex="#123456"), self.user, self.db)
        listed = {c.id: c.kind for c in read_classes(self.user, self.db)}
        self.assertEqual(listed[word.id], "word")
        self.assertEqual(listed[char.id], "char")
        for payload in [dict(display_name=" ", color_hex="#123456"), dict(display_name="Name", color_hex="red"), dict(display_name="Name", color_hex="#123456", kind="other")]:
            with self.assertRaises(ValidationError):
                schemas.ClassCreate(**payload)

    def test_assign_reset_all_changed_operation_types_and_reload(self):
        comp = self.upload(OPERATIONS)
        cls = self.make_class()
        for word in comp.word_ops:
            if word.op_type == "equal":
                continue
            assigned = self.assign(word, cls)
            self.assertEqual(assigned.class_id, cls.id)
            self.assertEqual(assigned.word_class.display_name, cls.display_name)
            loaded = read_comparison(comp.id, self.user, self.db)
            self.assertEqual(next(w for w in loaded.word_ops if w.id == word.id).class_id, cls.id)
            reset = self.assign(word, None)
            self.assertIsNone(reset.class_id)
            self.assertIsNone(reset.word_class)

    def test_reject_foreign_comparison_foreign_class_character_class_and_equal(self):
        comp = self.upload(OPERATIONS)
        word = comp.word_ops[0]
        for cls in [self.make_class(owner=self.other_user), self.make_class("char")]:
            with self.assertRaises(HTTPException) as caught:
                self.assign(word, cls)
            self.assertEqual(caught.exception.status_code, 422)
        own = self.make_class()
        with self.assertRaises(HTTPException) as caught:
            self.assign(word, own, self.other_user)
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            self.assign(comp.word_ops[1], own)
        self.assertIsNone(read_comparison(comp.id, self.user, self.db).word_ops[0].class_id)

    def test_character_assignment_rejects_word_classes_for_single_and_group(self):
        comp = self.upload(OPERATIONS)
        cls = self.make_class()
        char = comp.word_ops[0].char_ops[0]
        with self.assertRaises(HTTPException):
            update_char_op(char.id, schemas.CharOpUpdate(class_id=cls.id), self.user, self.db)
        with self.assertRaises(HTTPException):
            update_char_op_group(comp.id, schemas.CharOpGroupUpdate(op_type=char.op_type, from_str=char.from_str, to_str=char.to_str, class_id=cls.id), self.user, self.db)
        self.assertEqual(read_comparison(comp.id, self.user, self.db).word_ops[0].char_ops[0].class_id, char.class_id)

    def test_save_replaces_ids_but_preserves_classifications(self):
        comp = self.upload(OPERATIONS)
        cls = self.make_class()
        self.assign(comp.word_ops[0], cls)
        before = read_comparison(comp.id, self.user, self.db)
        save_comparison(comp.id, schemas.ComparisonSaveRequest(word_ops=before.model_dump()["word_ops"]), self.user, self.db)
        after = read_comparison(comp.id, self.user, self.db)
        self.assertNotEqual(after.word_ops[0].id, before.word_ops[0].id)
        self.assertEqual(after.word_ops[0].class_id, cls.id)
        self.assertEqual(after.word_ops[0].char_ops[0].class_id, before.word_ops[0].char_ops[0].class_id)

    def test_invalid_save_does_not_remove_existing_operations(self):
        comp = self.upload(OPERATIONS)
        for field in ["word", "char"]:
            payload = comp.model_dump()["word_ops"]
            if field == "word":
                payload[0]["class_id"] = self.make_class("char").id
            else:
                payload[0]["char_ops"][0]["class_id"] = self.make_class().id
            with self.assertRaises(HTTPException):
                save_comparison(comp.id, schemas.ComparisonSaveRequest(word_ops=payload), self.user, self.db)
            loaded = read_comparison(comp.id, self.user, self.db)
            self.assertEqual([w.id for w in loaded.word_ops], [w.id for w in comp.word_ops])

    def test_json_roundtrip_preserves_names_colors_grouping_and_remaps_word_ids(self):
        comp = self.upload(OPERATIONS)
        cls = self.make_class()
        self.assign(comp.word_ops[0], cls)
        self.assign(comp.word_ops[2], cls)
        exported = read_comparison(comp.id, self.user, self.db).model_dump(mode="json")["word_ops"]
        imported = self.upload(exported)
        a, b = imported.word_ops[0], imported.word_ops[2]
        self.assertNotEqual(a.class_id, cls.id)
        self.assertEqual(a.class_id, b.class_id)
        self.assertEqual(a.word_class.display_name, cls.display_name)
        self.assertEqual(a.word_class.color_hex, cls.color_hex)
        self.assertEqual(self.db.get(models.ClassCatalog, a.class_id).kind, "word")
        self.assertIsNone(imported.word_ops[3].class_id)
        self.assertEqual(imported.word_ops[0].base_token, OPERATIONS[0]["base_token"])

    def test_word_and_character_source_id_collision_keeps_classes_separate(self):
        payload = deepcopy(OPERATIONS)
        payload[0]["class_id"] = 3
        comp = self.upload(payload)
        self.assertNotEqual(comp.word_ops[0].class_id, comp.word_ops[0].char_ops[0].class_id)
        self.assertEqual(comp.word_ops[0].word_class.display_name, "Импортированный словесный класс №3")

    def test_conflicting_or_orphan_metadata_fails_without_creating_records(self):
        payload = deepcopy(OPERATIONS)
        description = dict(code="lexical", display_name="Лексическая", color_hex="#123456")
        payload[0].update(class_id=42, word_class=description)
        payload[2].update(class_id=42, word_class={**description, "color_hex": "#654321"})
        before = self.db.query(models.Comparison).count()
        with self.assertRaises(HTTPException): self.upload(payload)
        self.assertEqual(self.db.query(models.Comparison).count(), before)
        with self.assertRaises(ValidationError):
            schemas.ImportedWordOp(**{**OPERATIONS[0], "word_class": description})
        with self.assertRaises(ValidationError):
            schemas.ImportedWordOp(**{**OPERATIONS[1], "class_id": 42})

    def test_global_override_is_included_in_export_metadata(self):
        cls = models.ClassCatalog(owner_user_id=None, code="global-word-test", kind="word", display_name="Original", color_hex="#123456")
        self.db.add(cls); self.db.flush()
        self.db.add(models.ClassOverride(user_id=self.user.id, base_class_id=cls.id, custom_display_name="Моё название", custom_color_hex="#654321"))
        self.db.flush()
        comp = self.upload(OPERATIONS)
        assigned = self.assign(comp.word_ops[0], cls)
        self.assertEqual(assigned.word_class.display_name, "Моё название")
        self.assertEqual(assigned.word_class.color_hex, "#654321")

    def builtin(self):
        return self.db.query(models.ClassCatalog).filter_by(system_key="insignificant").one()

    def test_insignificant_is_mandatory_and_available_to_every_user(self):
        from backend.routers.classes import update_class_override
        builtin = self.builtin()
        self.assertEqual(builtin.kind, "word")
        self.assertIsNone(builtin.owner_user_id)
        for user in (self.user, self.other_user):
            listed = [c for c in read_classes(user, self.db) if c.system_key == "insignificant"]
            self.assertEqual(len(listed), 1)
            self.assertFalse(listed[0].hidden)
            self.assertEqual(listed[0].display_name, "Несущественные изменения")
        with self.assertRaises(HTTPException) as caught:
            update_class_override(builtin.id, schemas.ClassOverrideUpdate(hidden=True), self.user, self.db)
        self.assertEqual(caught.exception.status_code, 422)
        # Even a stale override cannot hide the mandatory catalog entry.
        self.db.add(models.ClassOverride(user_id=self.user.id, base_class_id=builtin.id, hidden=True, custom_display_name="Other"))
        self.db.flush()
        listed = next(c for c in read_classes(self.user, self.db) if c.id == builtin.id)
        self.assertFalse(listed.hidden)
        self.assertEqual(listed.display_name, "Несущественные изменения")

    def test_hiding_and_restoring_preserves_all_operation_and_character_data(self):
        comp = self.upload(OPERATIONS)
        builtin = self.builtin()
        for word in comp.word_ops:
            if word.op_type == "equal": continue
            hidden = self.assign(word, builtin)
            self.assertEqual(hidden.word_class.system_key, "insignificant")
            restored = self.assign(word, None)
            for key in ("op_type", "base_token", "other_token", "base_index", "other_index", "base_paragraph_index", "char_ops"):
                self.assertEqual(getattr(restored, key), getattr(word, key))
        char = comp.word_ops[0].char_ops[0]
        with self.assertRaises(HTTPException):
            update_char_op(char.id, schemas.CharOpUpdate(class_id=builtin.id), self.user, self.db)

    def test_insignificant_json_roundtrip_reuses_builtin_without_duplication(self):
        comp = self.upload(OPERATIONS)
        builtin = self.builtin()
        for word in comp.word_ops:
            if word.op_type != "equal": self.assign(word, builtin)
        exported = read_comparison(comp.id, self.user, self.db).model_dump(mode="json")["word_ops"]
        self.assertEqual(exported[0]["word_class"]["system_key"], "insignificant")
        # Files from other databases may use any numeric source ID.
        for word in exported:
            if word["class_id"]: word["class_id"] = 987654
        imported = self.upload(exported)
        for word in imported.word_ops:
            if word.op_type != "equal": self.assertEqual(word.class_id, builtin.id)
        self.assertEqual(self.db.query(models.ClassCatalog).filter_by(system_key="insignificant").count(), 1)
        save_comparison(imported.id, schemas.ComparisonSaveRequest(word_ops=imported.model_dump()["word_ops"]), self.user, self.db)
        loaded = read_comparison(imported.id, self.user, self.db)
        self.assertEqual(loaded.word_ops[0].word_class.system_key, "insignificant")
        self.assertEqual(loaded.word_ops[0].char_ops[0].class_id, imported.word_ops[0].char_ops[0].class_id)

    def test_same_name_or_code_does_not_make_an_ordinary_class_special(self):
        builtin = self.builtin()
        ordinary = create_class(schemas.ClassCreate(code=builtin.code, display_name=builtin.display_name, color_hex=builtin.color_hex, kind="word"), self.user, self.db)
        self.assertIsNone(ordinary.system_key)
        comp = self.upload(OPERATIONS)
        self.assertIsNone(self.assign(comp.word_ops[0], ordinary).word_class.system_key)
        exported = read_comparison(comp.id, self.user, self.db).model_dump(mode="json")["word_ops"]
        imported = self.upload(exported)
        self.assertNotEqual(imported.word_ops[0].class_id, builtin.id)
        self.assertIsNone(imported.word_ops[0].word_class.system_key)

    def test_batch_assignment_preserves_characters_and_other_rows(self):
        from backend.routers.comparisons import update_word_classes
        comp = self.upload(OPERATIONS)
        ids = [comp.word_ops[0].id, comp.word_ops[2].id]
        result = update_word_classes(comp.id, schemas.WordClassBatchUpdate(word_op_ids=ids, class_id=self.builtin().id), self.user, self.db)
        self.assertEqual({w.id for w in result}, set(ids))
        self.assertTrue(all(w.word_class.system_key == 'insignificant' for w in result))
        loaded = read_comparison(comp.id, self.user, self.db)
        self.assertIsNone(loaded.word_ops[1].class_id)
        self.assertIsNone(loaded.word_ops[3].class_id)
        self.assertEqual(loaded.word_ops[0].char_ops, comp.word_ops[0].char_ops)
        repeated = update_word_classes(comp.id, schemas.WordClassBatchUpdate(word_op_ids=ids + ids, class_id=self.builtin().id), self.user, self.db)
        self.assertEqual(len(repeated), 2)

    def test_invalid_batch_is_atomic(self):
        from backend.routers.comparisons import update_word_classes
        comp = self.upload(OPERATIONS)
        other = self.upload(OPERATIONS)
        for invalid_id in [comp.word_ops[1].id, other.word_ops[0].id, 2147483647]:
            with self.assertRaises(HTTPException):
                update_word_classes(comp.id, schemas.WordClassBatchUpdate(word_op_ids=[comp.word_ops[0].id, invalid_id], class_id=self.builtin().id), self.user, self.db)
            self.assertIsNone(read_comparison(comp.id, self.user, self.db).word_ops[0].class_id)

    def test_batch_checks_class_kind_and_ownership(self):
        from backend.routers.comparisons import update_word_classes
        comp = self.upload(OPERATIONS)
        for cls in [self.make_class('char'), self.make_class(owner=self.other_user)]:
            with self.assertRaises(HTTPException):
                update_word_classes(comp.id, schemas.WordClassBatchUpdate(word_op_ids=[comp.word_ops[0].id], class_id=cls.id), self.user, self.db)
        with self.assertRaises(HTTPException) as caught:
            update_word_classes(comp.id, schemas.WordClassBatchUpdate(word_op_ids=[comp.word_ops[0].id], class_id=self.builtin().id), self.other_user, self.db)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIsNone(read_comparison(comp.id, self.user, self.db).word_ops[0].class_id)
        for ids in [[], [0], [-1], ['123'], [True]]:
            with self.assertRaises(ValidationError):
                schemas.WordClassBatchUpdate(word_op_ids=ids, class_id=self.builtin().id)
