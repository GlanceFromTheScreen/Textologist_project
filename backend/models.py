from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, Float, DateTime, Enum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from .database import Base

# Enums
class UserRole(enum.Enum):
    admin = "admin"
    textologist = "textologist"

class SourceType(enum.Enum):
    txt = "txt"
    docx = "docx"

class FontFormat(enum.Enum):
    ttf = "ttf"
    otf = "otf"
    woff = "woff"

class OpType(enum.Enum):
    insert = "insert"
    delete = "delete"
    change = "change" # For char ops

class WordOpType(enum.Enum):
    equal = "equal"
    delete = "delete"
    insert = "insert"
    replace = "replace"

class ComparisonAlgorithm(enum.Enum):
    levenshtein = "levenshtein"
    levenshtein_nested = "levenshtein_nested"
    levenshtein_v2 = "levenshtein_v2"
    myers = "myers"

class CharOpSource(enum.Enum):
    classifier = "classifier"
    preset = "preset"
    manual = "manual"

# Models

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.textologist)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    texts = relationship("TextModel", back_populates="owner")
    fonts = relationship("Font", back_populates="owner")
    presets = relationship("Preset", back_populates="owner")
    comparisons = relationship("Comparison", back_populates="owner")

class TextModel(Base):
    __tablename__ = "texts"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    source_type = Column(Enum(SourceType), nullable=False)
    file_path = Column(String, nullable=False)
    extracted_paragraphs_json = Column(JSON, nullable=False) # list[str]
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="texts")
    # Comparisons where this text is base or other
    comparisons_as_base = relationship("Comparison", foreign_keys="[Comparison.base_text_id]", back_populates="base_text")
    comparisons_as_other = relationship("Comparison", foreign_keys="[Comparison.other_text_id]", back_populates="other_text")

class Font(Base):
    __tablename__ = "fonts"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    format = Column(Enum(FontFormat), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="fonts")

class ClassCatalog(Base):
    __tablename__ = "class_catalog"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Null for global
    code = Column(String, nullable=False) # Identifier
    display_name = Column(String, nullable=False)
    color_hex = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    overrides = relationship("ClassOverride", back_populates="base_class")
    preset_rules = relationship("PresetRule", back_populates="assigned_class")
    char_ops = relationship("ComparisonCharOp", back_populates="assigned_class")

class ClassOverride(Base):
    __tablename__ = "class_overrides"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    base_class_id = Column(Integer, ForeignKey("class_catalog.id"), nullable=False)
    custom_display_name = Column(String, nullable=True)
    custom_color_hex = Column(String, nullable=True)
    hidden = Column(Boolean, default=False)

    base_class = relationship("ClassCatalog", back_populates="overrides")

class Preset(Base):
    __tablename__ = "presets"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_from_text_a_id = Column(Integer, ForeignKey("texts.id"), nullable=True)
    created_from_text_b_id = Column(Integer, ForeignKey("texts.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="presets")
    rules = relationship("PresetRule", back_populates="preset", cascade="all, delete-orphan")

class PresetRule(Base):
    __tablename__ = "preset_rules"

    id = Column(Integer, primary_key=True, index=True)
    preset_id = Column(Integer, ForeignKey("presets.id"), nullable=False)
    op_type = Column(Enum(OpType), nullable=False)
    from_str = Column(Text, nullable=False, default="")
    to_str = Column(Text, nullable=False, default="")
    class_id = Column(Integer, ForeignKey("class_catalog.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    preset = relationship("Preset", back_populates="rules")
    assigned_class = relationship("ClassCatalog", back_populates="preset_rules")

class Comparison(Base):
    __tablename__ = "comparisons"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    base_text_id = Column(Integer, ForeignKey("texts.id"), nullable=False)
    other_text_id = Column(Integer, ForeignKey("texts.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    weight_replace = Column(Float, default=1.0)
    weight_delete = Column(Float, default=1.0)
    weight_insert = Column(Float, default=1.0)
    
    algorithm = Column(Enum(ComparisonAlgorithm), default=ComparisonAlgorithm.levenshtein)
    selected_font_id = Column(Integer, ForeignKey("fonts.id"), nullable=True)
    selected_preset_id = Column(Integer, ForeignKey("presets.id"), nullable=True)
    
    saved = Column(Boolean, default=False)
    dirty_for_preset = Column(Boolean, default=False)

    owner = relationship("User", back_populates="comparisons")
    base_text = relationship("TextModel", foreign_keys=[base_text_id], back_populates="comparisons_as_base")
    other_text = relationship("TextModel", foreign_keys=[other_text_id], back_populates="comparisons_as_other")
    
    # Configure cascade delete here as well for SQLAlchemy level
    word_ops = relationship("ComparisonWordOp", back_populates="comparison", cascade="all, delete-orphan", passive_deletes=True)
    char_ops = relationship("ComparisonCharOp", back_populates="comparison", cascade="all, delete-orphan", passive_deletes=True)

class ComparisonWordOp(Base):
    __tablename__ = "comparison_word_ops"

    id = Column(Integer, primary_key=True, index=True)
    # Add ondelete="CASCADE" to ForeignKey
    comparison_id = Column(Integer, ForeignKey("comparisons.id", ondelete="CASCADE"), nullable=False, index=True)
    op_type = Column(Enum(WordOpType), nullable=False)
    
    base_index = Column(Integer, nullable=True)
    other_index = Column(Integer, nullable=True)
    base_token = Column(Text, nullable=True)
    other_token = Column(Text, nullable=True)
    base_paragraph_index = Column(Integer, nullable=True) # 0-based storage, 1-based display
    order_index = Column(Integer, nullable=False, server_default='0')
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    comparison = relationship("Comparison", back_populates="word_ops")
    # Configure cascade delete here as well for SQLAlchemy level
    char_ops = relationship("ComparisonCharOp", back_populates="word_op", cascade="all, delete-orphan", passive_deletes=True)

class ComparisonCharOp(Base):
    __tablename__ = "comparison_char_ops"

    id = Column(Integer, primary_key=True, index=True)
    # Add ondelete="CASCADE" to ForeignKey
    comparison_id = Column(Integer, ForeignKey("comparisons.id", ondelete="CASCADE"), nullable=False, index=True)
    # Add ondelete="CASCADE" to ForeignKey
    word_op_id = Column(Integer, ForeignKey("comparison_word_ops.id", ondelete="CASCADE"), nullable=True) # Only for replace
    
    op_type = Column(Enum(OpType), nullable=False)
    from_str = Column(Text, nullable=False, default="")
    to_str = Column(Text, nullable=False, default="")
    pos_info_json = Column(JSON, nullable=True)
    
    class_id = Column(Integer, ForeignKey("class_catalog.id"), nullable=True)
    source = Column(Enum(CharOpSource), default=CharOpSource.classifier)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    comparison = relationship("Comparison", back_populates="char_ops")
    word_op = relationship("ComparisonWordOp", back_populates="char_ops")
    assigned_class = relationship("ClassCatalog", back_populates="char_ops")
