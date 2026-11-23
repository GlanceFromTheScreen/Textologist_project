import re
from typing import List, Optional
from .structures import TokenizationResult


def tokenize_paragraphs(paragraphs: List[str], separators: Optional[List[str]] = None) -> TokenizationResult:
    """Split on the selected literal characters; paragraph boundaries always split.

    Separators are discarded, consecutive separators do not create empty tokens.
    No other whitespace or punctuation is normalized.
    """
    separators = [' '] if separators is None else separators
    if not isinstance(separators, list) or not separators or any(not isinstance(char, str) or len(char) != 1 for char in separators):
        raise ValueError('Выберите хотя бы один разделитель; каждый разделитель должен быть одним символом.')
    pattern = re.compile('[' + re.escape(''.join(dict.fromkeys(separators))) + ']+')
    all_tokens, token_indices = [], []
    for index, paragraph in enumerate(paragraphs):
        for token in pattern.split(paragraph):
            if token != '':
                all_tokens.append(token)
                token_indices.append(index)
    return TokenizationResult(tokens=all_tokens, token_paragraph_index=token_indices)
