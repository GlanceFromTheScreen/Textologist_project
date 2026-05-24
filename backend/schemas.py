from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    admin = "admin"
    textologist = "textologist"

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str
    role: Optional[UserRole] = UserRole.textologist

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

class ComparisonAlgorithm(str, Enum):
    levenshtein = "levenshtein"
    levenshtein_nested = "levenshtein_nested"
    levenshtein_v2 = "levenshtein_v2"
    myers = "myers"

class Weights(BaseModel):
    replace: float = 1.0
    delete: float = 1.0
    insert: float = 1.0
    char_replace: float = 1.0
    char_delete: float = 1.0
    char_insert: float = 1.0

class ComparisonCreate(BaseModel):
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
    class_id: Optional[int] = None

class WordOpInput(BaseModel):
    op_type: WordOpType
    base_index: Optional[int] = None
    other_index: Optional[int] = None
    base_token: Optional[str] = None
    other_token: Optional[str] = None
    base_paragraph_index: Optional[int] = None
    char_ops: List[CharOpInput] = []

class ComparisonSaveRequest(BaseModel):
    word_ops: Optional[List[WordOpInput]] = None

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
    id: int
    op_type: WordOpType
    base_index: Optional[int]
    other_index: Optional[int]
    base_token: Optional[str]
    other_token: Optional[str]
    base_paragraph_index: Optional[int]
    char_ops: List[CharOpRead] = []

    class Config:
        from_attributes = True

class ComparisonRead(BaseModel):
    id: int
    base_text_id: int
    other_text_id: int
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
    op_type: OpType
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
    name: str
    description: Optional[str] = None

# Stats Schemas

class StatsTotals(BaseModel):
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

class DistanceMatrixRequest(BaseModel):
    text_ids: List[int]
    weights: Weights
    algorithm: ComparisonAlgorithm = ComparisonAlgorithm.levenshtein

class DistanceMatrixResponse(BaseModel):
    labels: List[str] # Text titles
    matrix: List[List[float]]

# Class Schemas

class ClassBase(BaseModel):
    code: str
    display_name: str
    color_hex: str

class ClassCreate(ClassBase):
    pass

class ClassRead(ClassBase):
    id: int
    owner_user_id: Optional[int]
    is_global: bool = False
    hidden: bool = False # Resolved visibility
    
    class Config:
        from_attributes = True

class ClassOverrideUpdate(BaseModel):
    custom_display_name: Optional[str] = None
    custom_color_hex: Optional[str] = None
    hidden: Optional[bool] = None
