from pydantic import BaseModel, Field, StringConstraints, model_validator
from typing import Annotated, Optional, List, Any, Literal
from datetime import datetime
from enum import Enum
import uuid

class ClassKind(str, Enum):
    word = "word"
    char = "char"

ClassName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ClassCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ClassColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]

class WordClassDescription(BaseModel):
    system_key: Optional[Literal["insignificant"]] = None
    code: ClassCode
    display_name: ClassName
    color_hex: ClassColor

    class Config:
        from_attributes = True

class UserRole(str, Enum):
    admin = "admin"
    user = "user"

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str
    role: Optional[UserRole] = UserRole.user

AccountLogin = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100, pattern=r"^[^\s]+$")]
AccountPassword = Annotated[str, StringConstraints(min_length=1, max_length=256)]

class AdminUserCreate(BaseModel):
    username: AccountLogin
    password: AccountPassword

    class Config:
        extra = "forbid"

class AdminUserUpdate(BaseModel):
    username: Optional[AccountLogin] = None
    password: Optional[AccountPassword] = None

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set or any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Укажите новый логин или пароль")
        return self

    class Config:
        extra = "forbid"

class UserLogin(UserBase):
    password: str

class User(UserBase):
    id: int
    role: UserRole
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class SourceType(str, Enum):
    txt = "txt"
    docx = "docx"

class TextBase(BaseModel):
    title: str
    source_type: SourceType

class TextCreate(TextBase):
    pass

class TextRenameRequest(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

class Text(TextBase):
    id: int
    owner_user_id: int
    file_path: str
    extracted_paragraphs_json: List[str]
    created_at: datetime

    class Config:
        from_attributes = True

class TextSummary(TextBase):
    id: int
    owner_user_id: int
    created_at: datetime
    # Exclude extracted_paragraphs_json for list view to save bandwidth

    class Config:
        from_attributes = True

class FontFormat(str, Enum):
    ttf = "ttf"
    otf = "otf"
    woff = "woff"

class FontBase(BaseModel):
    name: str
    format: FontFormat

class FontCreate(FontBase):
    pass

class Font(FontBase):
    id: int
    owner_user_id: int
    file_path: str
    created_at: datetime

    class Config:
        from_attributes = True

# Comparison Schemas

class OpType(str, Enum):
    insert = "insert"
    delete = "delete"
    change = "change"

class WordOpType(str, Enum):
    equal = "equal"
    delete = "delete"
    insert = "insert"
    replace = "replace"
    transpose = "transpose"

class ComparisonAlgorithm(str, Enum):
    levenshtein = "levenshtein"
    levenshtein_nested = "levenshtein_nested"
    levenshtein_v2 = "levenshtein_v2"
    myers = "myers"

class Weights(BaseModel):
    transpose: float = Field(default=1.0, ge=0, allow_inf_nan=False)
    replace: float = 1.0
    delete: float = 1.0
    insert: float = 1.0
    char_replace: float = 1.0
    char_delete: float = 1.0
    char_insert: float = 1.0

Separator = Annotated[str, StringConstraints(min_length=1, max_length=1)]
Separators = Annotated[List[Separator], Field(min_length=1)]

class TokenizationSettings(BaseModel):
    separators: Separators = Field(default_factory=lambda: [" "])

    @model_validator(mode="after")
    def unique_separators(self):
        self.separators = list(dict.fromkeys(self.separators))
        return self

class ComparisonCreate(TokenizationSettings):
    base_text_id: int
    other_text_id: int
    weights: Weights
    preset_id: Optional[int] = None
    font_id: Optional[int] = None
    algorithm: Optional[ComparisonAlgorithm] = ComparisonAlgorithm.levenshtein

class CharOpInput(BaseModel):
    op_type: OpType
    from_str: str
    to_str: str
    class_id: Optional[int] = Field(default=None, ge=1, strict=True)

class TranspositionPart(BaseModel):
    op_type: Literal["replace"] = "replace"
    base_index: Optional[int] = Field(default=None, ge=0, strict=True)
    other_index: Optional[int] = Field(default=None, ge=0, strict=True)
    base_token: Annotated[str, StringConstraints(min_length=1)]
    other_token: Annotated[str, StringConstraints(min_length=1)]
    base_paragraph_index: Optional[int] = Field(default=None, ge=0, strict=True)
    char_ops: List[CharOpInput] = Field(default_factory=list)
    class_id: Optional[int] = Field(default=None, ge=1, strict=True)
    word_class: Optional[WordClassDescription] = None

    @model_validator(mode="after")
    def validate_class_description(self):
        if self.word_class is not None and self.class_id is None:
            raise ValueError("word_class requires class_id")
        return self


class WordOpInput(BaseModel):
    transpose_parts: Optional[List[TranspositionPart]] = Field(default=None, min_length=2, max_length=2)
    op_type: WordOpType
    base_index: Optional[int] = None
    other_index: Optional[int] = None
    base_token: Optional[str] = None
    other_token: Optional[str] = None
    base_paragraph_index: Optional[int] = None
    char_ops: List[CharOpInput] = []
    class_id: Optional[int] = Field(default=None, ge=1, strict=True)

    @model_validator(mode="after")
    def equal_has_no_class(self):
        if self.op_type == WordOpType.transpose:
            if not self.transpose_parts:
                raise ValueError("A transposition requires two replacement parts")
            a, b = self.transpose_parts
            if a.base_token == b.base_token or a.base_token != b.other_token or b.base_token != a.other_token:
                raise ValueError("A transposition must swap two distinct, exactly matching adjacent tokens")
            if self.base_token != f"{a.base_token} {b.base_token}" or self.other_token != f"{a.other_token} {b.other_token}":
                raise ValueError("Transposition tokens must match its parts")
            if self.base_paragraph_index != a.base_paragraph_index or self.base_index != a.base_index or self.other_index != a.other_index:
                raise ValueError("Transposition position must match its first part")
            for field in ("base_index", "other_index"):
                first, second = getattr(a, field), getattr(b, field)
                if first is not None and second is not None and second != first + 1:
                    raise ValueError("Transposition indices must be adjacent")
            if self.char_ops:
                raise ValueError("Store character annotations in the transposition parts")
        elif self.transpose_parts is not None:
            raise ValueError("Only transpositions can contain replacement parts")
        if self.op_type == WordOpType.equal and self.class_id is not None:
            raise ValueError("Unchanged words cannot have a word-change class")
        return self

class ComparisonSaveRequest(BaseModel):
    word_ops: Optional[List[WordOpInput]] = None

ComparisonTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

class ComparisonRenameRequest(BaseModel):
    title: ComparisonTitle

class ComparisonFontUpdate(BaseModel):
    selected_font_id: Optional[int] = Field(..., ge=1, strict=True)

class ImportedCharOp(CharOpInput):
    class_id: Optional[int] = Field(default=None, ge=1, strict=True)

class ImportedWordOp(WordOpInput):
    base_index: Optional[int] = Field(default=None, ge=0, strict=True)
    other_index: Optional[int] = Field(default=None, ge=0, strict=True)
    base_paragraph_index: Optional[int] = Field(default=None, ge=0, strict=True)
    char_ops: List[ImportedCharOp] = Field(default_factory=list)
    word_class: Optional[WordClassDescription] = None

    @model_validator(mode="after")
    def validate_tokens(self):
        if self.word_class is not None and self.class_id is None:
            raise ValueError("word_class requires class_id")
        if self.op_type != WordOpType.insert and not self.base_token:
            raise ValueError("This operation requires a non-empty base_token")
        if self.op_type != WordOpType.delete and not self.other_token:
            raise ValueError("This operation requires a non-empty other_token")
        if self.op_type == WordOpType.equal and self.base_token != self.other_token:
            raise ValueError("An equal operation must contain identical tokens")
        return self

class CharDiffRequest(BaseModel):
    base_token: str
    other_token: str

class CharOpRead(BaseModel):
    id: int
    op_type: OpType
    from_str: str
    to_str: str
    class_id: Optional[int]
    
    class Config:
        from_attributes = True

class WordOpRead(BaseModel):
    transpose_parts: Optional[List[TranspositionPart]] = None
    id: int
    op_type: WordOpType
    base_index: Optional[int]
    other_index: Optional[int]
    base_token: Optional[str]
    other_token: Optional[str]
    base_paragraph_index: Optional[int]
    char_ops: List[CharOpRead] = []
    class_id: Optional[int] = None
    word_class: Optional[WordClassDescription] = None

    class Config:
        from_attributes = True

class ComparisonRead(TokenizationSettings):
    id: int
    title: Optional[str] = None
    base_text_id: Optional[int]
    other_text_id: Optional[int]
    saved: bool = False
    dirty_for_preset: bool = False
    created_at: datetime
    weights: dict = {} # Flattened weights
    selected_font_id: Optional[int] = None
    algorithm: ComparisonAlgorithm
    
    # New fields for titles. 
    # Since these are not direct columns on the model, we might need validators or property accessors 
    # OR we rely on SQLAlchemy relationship auto-loading if we name them correctly?
    # Pydantic `from_attributes` works with relationships if the data is loaded.
    # In models.py: base_text = relationship("TextModel"...)
    # So we can access `base_text.title`.
    # But to flatten it here, we might need a custom validator or just nested objects.
    # Let's use nested simplified objects or computed fields.
    
    base_text_title: Optional[str] = None
    other_text_title: Optional[str] = None

    class Config:
        from_attributes = True

class ComparisonDetail(ComparisonRead):
    word_ops: List[WordOpRead]

# Comparison Update Schemas

class WordClassUpdate(BaseModel):
    class_id: Optional[int] = Field(..., ge=1, strict=True)

class WordClassBatchUpdate(WordClassUpdate):
    word_op_ids: List[Annotated[int, Field(ge=1, strict=True)]] = Field(min_length=1, max_length=50000)

class CharOpUpdate(BaseModel):
    class_id: Optional[int]

class CharOpGroupUpdate(BaseModel):
    op_type: OpType
    from_str: str
    to_str: str
    class_id: Optional[int]

class CharOpGroupItem(BaseModel):
    char_op_id: int
    old_word: Optional[str]
    new_word: Optional[str]
    paragraph_index: Optional[int]
    class_id: Optional[int]

class CharOpGroupResponse(BaseModel):
    group_key: str # op_type|from|to
    items: List[CharOpGroupItem]

# Presets Schemas

class PresetRuleBase(BaseModel):
    kind: Literal["char", "word"] = "char"
    op_type: Literal["change", "replace", "insert", "delete", "transpose"]
    base_word: Optional[str] = None
    other_word: Optional[str] = None
    is_deleted: bool = False
    from_str: str
    to_str: str
    class_id: Optional[int]

class PresetRuleCreate(PresetRuleBase):
    pass

class PresetRuleRead(PresetRuleBase):
    id: int
    preset_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class PresetBase(BaseModel):
    name: str
    description: Optional[str] = None

class PresetCreate(PresetBase):
    pass

class PresetRead(PresetBase):
    id: int
    owner_user_id: int
    created_at: datetime
    rules: List[PresetRuleRead] = []

    class Config:
        from_attributes = True

class SaveAsPresetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None

# Stats Schemas

class StatsTotals(BaseModel):
    transpose: int = 0
    replace: int
    insert: int
    delete: int

class TopWordReplacement(BaseModel):
    from_token: str
    to_token: str
    count: int

class TopCharOp(BaseModel):
    op_type: OpType
    from_str: str
    to_str: str
    count: int
    unique_contexts: int
    frequency: float # Added

class ClassDistributionItem(BaseModel):
    class_id: Optional[int]
    display_name: str
    color_hex: str
    count: int

class ComparisonStats(BaseModel):
    totals: StatsTotals
    top_word_replacements: List[TopWordReplacement]
    top_char_ops: List[TopCharOp]
    class_distribution: List[ClassDistributionItem]

# Matrix Schemas

class DistanceMatrixRequest(TokenizationSettings):
    text_ids: List[int]
    weights: Weights
    algorithm: ComparisonAlgorithm = ComparisonAlgorithm.levenshtein

class DistanceMatrixResponse(BaseModel):
    labels: List[str] # Text titles
    matrix: List[List[float]]

# Class Schemas

class ClassBase(BaseModel):
    code: ClassCode
    display_name: ClassName
    color_hex: ClassColor
    kind: ClassKind = ClassKind.char

class ClassCreate(ClassBase):
    code: ClassCode = Field(default_factory=lambda: uuid.uuid4().hex)

class ClassRead(ClassBase):
    system_key: Optional[Literal["insignificant"]] = None
    id: int
    owner_user_id: Optional[int]
    is_global: bool = False
    hidden: bool = False # Resolved visibility
    
    class Config:
        from_attributes = True

class ClassOverrideUpdate(BaseModel):
    custom_display_name: Optional[ClassName] = None
    custom_color_hex: Optional[ClassColor] = None
    hidden: Optional[bool] = None
