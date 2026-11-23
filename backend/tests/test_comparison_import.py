"""Integration tests against the configured PostgreSQL database, rolled back per test."""
import io
import json
import os
import unittest
import uuid

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from backend import database, models, schemas
from backend.routers.comparisons import (
    MAX_IMPORT_BYTES, import_comparison, read_comparison,
    read_comparisons, rename_comparison, save_comparison,
    update_comparison_font,
)
from backend.routers.texts import rename_text
from backend.reconstructed_texts import reconstruct_paragraphs, restore_comparison_texts


OPERATIONS = [
    {"id": 5142, "op_type": "replace", "base_index": 0, "other_index": 0,
     "base_token": "дьни", "other_token": "дн͡и", "base_paragraph_index": 0,
     "char_ops": [{"id": 7001, "op_type": "change", "from_str": "ь", "to_str": "͡", "class_id": 3}]},
    {"id": 5143, "op_type": "equal", "base_index": 1, "other_index": 1,
     "base_token": "вѣка", "other_token": "вѣка", "base_paragraph_index": 0, "char_ops": []},
    {"id": 5163, "op_type": "insert", "base_index": None, "other_index": 2,
     "base_token": None, "other_token": "ра", "base_paragraph_index": None, "char_ops": []},
    {"id": 5186, "op_type": "delete", "base_index": 2, "other_index": None,
     "base_token": "сѧ", "other_token": None, "base_paragraph_index": 1, "char_ops": []},
]


class ComparisonDatabaseTestCase(unittest.TestCase):
    def setUp(self):
        self.connection = database.engine.connect()
        self.transaction = self.connection.begin()
        self.db = Session(bind=self.connection, join_transaction_mode="create_savepoint")
        self.user = models.User(username=f"import-test-{uuid.uuid4().hex}", password_hash="unused")
        self.other_user = models.User(username=f"other-test-{uuid.uuid4().hex}", password_hash="unused")
        self.db.add_all([self.user, self.other_user])
        self.db.flush()

    def tearDown(self):
        self.db.close()
        self.transaction.rollback()
        self.connection.close()

    def upload(self, payload, filename="29.json"):
        content = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        return import_comparison(UploadFile(filename=filename, file=io.BytesIO(content)), self.user, self.db)

    def assert_operations_preserved(self, original, imported):
        self.assertEqual(len(original), len(imported.word_ops))
        class_map = {}
        for old, new in zip(original, imported.word_ops):
            for field in ("op_type", "base_index", "other_index", "base_token", "other_token", "base_paragraph_index"):
                self.assertEqual(old.get(field), getattr(new, field))
            self.assertEqual(len(old.get("char_ops", [])), len(new.char_ops))
            for old_char, new_char in zip(old.get("char_ops", []), new.char_ops):
                for field in ("op_type", "from_str", "to_str"):
                    self.assertEqual(old_char[field], getattr(new_char, field))
                old_class = old_char.get("class_id")
                if old_class is None:
                    self.assertIsNone(new_char.class_id)
                else:
                    class_map.setdefault(old_class, new_char.class_id)
                    self.assertEqual(class_map[old_class], new_char.class_id)
                    cls = self.db.get(models.ClassCatalog, new_char.class_id)
                    self.assertEqual(cls.owner_user_id, self.user.id)
                    self.assertEqual(cls.display_name, f"Импортированный класс №{old_class}")


class ComparisonImportTests(ComparisonDatabaseTestCase):
    def test_import_is_saved_and_restores_both_texts(self):
        result = self.upload(OPERATIONS)
        self.assertEqual(result.title, "29")
        self.assertTrue(result.saved)
        self.assertIsNotNone(result.base_text_id)
        self.assertIsNotNone(result.other_text_id)
        base = self.db.get(models.TextModel, result.base_text_id)
        other = self.db.get(models.TextModel, result.other_text_id)
        self.assertEqual(base.extracted_paragraphs_json, ["дьни вѣка", "сѧ"])
        self.assertEqual(other.extracted_paragraphs_json, ["дн͡и вѣка ра"])
        self.assertEqual(base.title, "29 — Основной текст")
        self.assertEqual(other.title, "29 — Сравниваемый текст")
        self.assert_operations_preserved(OPERATIONS, result)
        self.assertEqual(self.db.query(models.TextModel).filter_by(owner_user_id=self.user.id).count(), 2)
        history = read_comparisons(0, 100, True, self.user, self.db)
        self.assertEqual([item.id for item in history], [result.id])

    def test_class_ids_are_not_reused_from_another_database(self):
        foreign_class = models.ClassCatalog(owner_user_id=self.other_user.id, code="private", display_name="Private", color_hex="#000000")
        self.db.add(foreign_class)
        self.db.flush()
        payload = json.loads(json.dumps(OPERATIONS))
        payload[0]["char_ops"][0]["class_id"] = foreign_class.id
        result = self.upload(payload)
        self.assertNotEqual(result.word_ops[0].char_ops[0].class_id, foreign_class.id)
        self.assert_operations_preserved(payload, result)

    def test_rename_persists_and_is_owner_only(self):
        result = self.upload(OPERATIONS)
        renamed = rename_comparison(result.id, schemas.ComparisonRenameRequest(title="  Рукопись — сравнение  "), self.user, self.db)
        self.assertEqual(renamed.title, "Рукопись — сравнение")
        self.db.expire_all()
        self.assertEqual(read_comparison(result.id, self.user, self.db).title, renamed.title)
        self.assertEqual(read_comparisons(0, 100, True, self.user, self.db)[0].title, renamed.title)
        with self.assertRaises(HTTPException) as error:
            rename_comparison(result.id, schemas.ComparisonRenameRequest(title="Foreign edit"), self.other_user, self.db)
        self.assertEqual(error.exception.status_code, 404)

    def test_existing_comparison_can_be_renamed_without_changing_text_titles(self):
        texts = [models.TextModel(owner_user_id=self.user.id, title=title, source_type=models.SourceType.txt, file_path="", extracted_paragraphs_json=[title]) for title in ("Base", "Other")]
        self.db.add_all(texts)
        self.db.flush()
        comp = models.Comparison(owner_user_id=self.user.id, base_text_id=texts[0].id, other_text_id=texts[1].id, saved=True)
        self.db.add(comp)
        self.db.flush()
        renamed = rename_comparison(comp.id, schemas.ComparisonRenameRequest(title="New name"), self.user, self.db)
        self.assertEqual(renamed.base_text_title, "Base")
        self.assertEqual(renamed.other_text_title, "Other")
        self.assertEqual(renamed.title, "New name")

    def test_edit_save_and_export_import_round_trip(self):
        result = self.upload(OPERATIONS)
        payload = [word.model_dump(mode="json") for word in result.word_ops]
        payload[0]["other_token"] = "изменено"
        request = schemas.ComparisonSaveRequest(word_ops=payload)
        save_comparison(result.id, request, self.user, self.db)
        self.db.expire_all()
        exported = [word.model_dump(mode="json") for word in read_comparison(result.id, self.user, self.db).word_ops]
        reimported = self.upload(exported, "roundtrip.json")
        self.assert_operations_preserved(exported, reimported)

    def test_invalid_imports_create_no_records(self):
        invalid = [b"{", b"\xff", {}, [], [{"op_type": "unknown"}], [{"op_type": "replace", "base_token": "a"}], [{"op_type": "equal", "base_token": "a", "other_token": "b"}], [{**OPERATIONS[0], "base_index": -1}]]
        for payload in invalid:
            with self.subTest(payload=payload):
                with self.assertRaises(HTTPException) as error:
                    self.upload(payload)
                self.assertIn(error.exception.status_code, (400, 422))
        self.assertEqual(self.db.query(models.Comparison).filter_by(owner_user_id=self.user.id).count(), 0)
        self.assertEqual(self.db.query(models.ClassCatalog).filter_by(owner_user_id=self.user.id).count(), 0)
        self.assertEqual(self.db.query(models.TextModel).filter_by(owner_user_id=self.user.id).count(), 0)

    def test_reconstruction_uses_operation_order_and_handles_missing_indices(self):
        operations = [
            {"op_type": "insert", "other_token": "начало"},
            {"op_type": "equal", "base_token": "дн͡и", "other_token": "дн͡и", "base_paragraph_index": 10, "base_index": 8, "other_index": 9},
            {"op_type": "equal", "base_token": "дн͡и", "other_token": "дн͡и", "base_paragraph_index": 10, "base_index": 8, "other_index": 9},
            {"op_type": "replace", "base_token": "старое", "other_token": "новое", "base_paragraph_index": 1000000},
            {"op_type": "insert", "other_token": "конец"},
        ]
        base, other = reconstruct_paragraphs([schemas.ImportedWordOp(**op) for op in operations])
        self.assertEqual(base, ["дн͡и дн͡и", "старое"])
        self.assertEqual(other, ["начало дн͡и дн͡и", "новое конец"])

    def test_reconstruction_accepts_an_empty_side(self):
        for operation, expected in [
            ({"op_type": "insert", "other_token": "новое"}, ([], ["новое"])),
            ({"op_type": "delete", "base_token": "старое"}, (["старое"], [])),
        ]:
            self.assertEqual(reconstruct_paragraphs([schemas.ImportedWordOp(**operation)]), expected)

    def test_restoring_old_imports_is_idempotent_and_preserves_renames(self):
        comp = models.Comparison(owner_user_id=self.user.id, title="Legacy import", saved=True)
        self.db.add(comp)
        self.db.flush()
        operations = [schemas.ImportedWordOp(**op) for op in OPERATIONS]
        self.assertTrue(restore_comparison_texts(self.db, comp, operations))
        original_ids = (comp.base_text_id, comp.other_text_id)
        comp.base_text.title = "User title"
        self.assertFalse(restore_comparison_texts(self.db, comp, operations))
        self.assertEqual((comp.base_text_id, comp.other_text_id), original_ids)
        self.assertEqual(comp.base_text.title, "User title")
        self.assertEqual(self.db.query(models.TextModel).filter_by(owner_user_id=self.user.id).count(), 2)

    def test_text_rename_updates_comparison_titles_but_not_content(self):
        comp = self.upload(OPERATIONS)
        original = list(self.db.get(models.TextModel, comp.base_text_id).extracted_paragraphs_json)
        renamed = rename_text(comp.base_text_id, schemas.TextRenameRequest(title="  Моя рукопись  "), self.user, self.db)
        self.assertEqual(renamed.title, "Моя рукопись")
        self.assertEqual(renamed.extracted_paragraphs_json, original)
        self.db.expire_all()
        detail = read_comparison(comp.id, self.user, self.db)
        self.assertEqual(detail.base_text_title, renamed.title)
        self.assertEqual(detail.title, "29")
        with self.assertRaises(HTTPException) as error:
            rename_text(comp.base_text_id, schemas.TextRenameRequest(title="Foreign edit"), self.other_user, self.db)
        self.assertEqual(error.exception.status_code, 404)
        for title in ("", "   ", "x" * 201):
            with self.assertRaises(ValidationError):
                schemas.TextRenameRequest(title=title)

    def test_font_selection_is_persistent_and_can_be_reset(self):
        comp = self.upload(OPERATIONS)
        font = models.Font(owner_user_id=self.user.id, name="Test font", file_path="unused", format=models.FontFormat.ttf)
        self.db.add(font)
        self.db.flush()
        update_comparison_font(comp.id, schemas.ComparisonFontUpdate(selected_font_id=font.id), self.user, self.db)
        self.db.expire_all()
        updated = read_comparison(comp.id, self.user, self.db)
        self.assertEqual(updated.selected_font_id, font.id)
        self.assertTrue(updated.saved)
        self.assertEqual(updated.title, comp.title)
        self.assert_operations_preserved(OPERATIONS, updated)
        update_comparison_font(comp.id, schemas.ComparisonFontUpdate(selected_font_id=None), self.user, self.db)
        self.db.expire_all()
        self.assertIsNone(read_comparison(comp.id, self.user, self.db).selected_font_id)

    def test_font_selection_checks_comparison_and_font_ownership(self):
        comp = self.upload(OPERATIONS)
        foreign_font = models.Font(owner_user_id=self.other_user.id, name="Private font", file_path="unused", format=models.FontFormat.ttf)
        self.db.add(foreign_font)
        self.db.flush()
        for user, font_id in ((self.user, foreign_font.id), (self.other_user, None), (self.user, 2147483647)):
            with self.assertRaises(HTTPException) as error:
                update_comparison_font(comp.id, schemas.ComparisonFontUpdate(selected_font_id=font_id), user, self.db)
            self.assertEqual(error.exception.status_code, 404)
        self.assertIsNone(read_comparison(comp.id, self.user, self.db).selected_font_id)
        for payload in ({}, {"selected_font_id": -1}, {"selected_font_id": "1"}):
            with self.assertRaises(ValidationError):
                schemas.ComparisonFontUpdate(**payload)

    def test_size_limit_and_utf8_bom(self):
        with self.assertRaises(HTTPException) as error:
            self.upload(b" " * (MAX_IMPORT_BYTES + 1))
        self.assertEqual(error.exception.status_code, 413)
        self.assertTrue(self.upload(b"\xef\xbb\xbf" + json.dumps(OPERATIONS).encode()).saved)

    def test_invalid_names(self):
        for title in ("", "   ", "x" * 201):
            with self.assertRaises(ValidationError):
                schemas.ComparisonRenameRequest(title=title)

    @unittest.skipUnless(os.getenv("COMPARISON_IMPORT_FIXTURE"), "Optional external JSON fixture")
    def test_user_supplied_json(self):
        with open(os.environ["COMPARISON_IMPORT_FIXTURE"], encoding="utf-8-sig") as file:
            payload = json.load(file)
        comparison = self.upload(payload)
        self.assert_operations_preserved(payload, comparison)
        for side, skip_type in (("base", "insert"), ("other", "delete")):
            text = self.db.get(models.TextModel, getattr(comparison, f"{side}_text_id"))
            tokens = [op[f"{side}_token"] for op in payload if op["op_type"] != skip_type and op.get(f"{side}_token") is not None]
            self.assertEqual(" ".join(text.extracted_paragraphs_json), " ".join(tokens))


if __name__ == "__main__":
    unittest.main()
