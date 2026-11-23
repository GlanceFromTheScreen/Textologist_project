from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum

class WordOpType(str, Enum):
    equal = "equal"
    delete = "delete"
    insert = "insert"
    replace = "replace"
    transpose = "transpose"

class CharOpType(str, Enum):
    insert = "insert"
    delete = "delete"
    change = "change"

@dataclass
class Weights:
    replace: float = 1.0
    delete: float = 1.0
    insert: float = 1.0
    # Used by levenshtein_v2 for character-level substitution cost (word replace path).
    char_replace: float = 1.0
    char_delete: float = 1.0
    char_insert: float = 1.0
    transpose: float = 1.0

@dataclass
class TokenizationResult:
    tokens: List[str]
    token_paragraph_index: List[int]

@dataclass
class WordOp:
    op_type: WordOpType
    base_index: Optional[int] = None
    other_index: Optional[int] = None
    base_token: Optional[str] = None
    other_token: Optional[str] = None
    transpose_tokens: Optional[List[str]] = None

@dataclass
class CharOp:
    op_type: CharOpType
    from_str: str
    to_str: str
    pos_info: Optional[dict] = None
