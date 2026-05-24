import re
from typing import List
from .structures import TokenizationResult

# Basic tokenizer: words (letters/numbers/underscore) or single punctuation characters
# Adjust regex as needed for "word" definition.
# Spec: "punctuation - separate tokens", "spaces are not tokens".
# TOKEN_REGEX = re.compile(r'\w+|[^\w\s]')
TOKEN_REGEX = re.compile(r'\S+')

def tokenize_paragraphs(paragraphs: List[str]) -> TokenizationResult:
    all_tokens = []
    token_indices = []

    for idx, para in enumerate(paragraphs):
        # We assume 0-based index here, UI adds 1
        matches = TOKEN_REGEX.findall(para)
        for token in matches:
            all_tokens.append(token)
            token_indices.append(idx)
            
    return TokenizationResult(
        tokens=all_tokens,
        token_paragraph_index=token_indices
    )
