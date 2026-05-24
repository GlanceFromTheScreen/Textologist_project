import docx
from docx import Document
import re
import json
import sys

# Tokenizer consistent with project standard (whitespace only)
TOKEN_REGEX = re.compile(r'\S+')

def clean_text_from_superscripts(paragraph):
    """
    Extracts text from a paragraph, ignoring superscript runs.
    """
    text_parts = []
    for run in paragraph.runs:
        if run.font.superscript:
            continue
        text_parts.append(run.text)
    return "".join(text_parts).strip()

def tokenize(text):
    return TOKEN_REGEX.findall(text)

def parse_variants_line(line_text):
    """
    Parses a variant line: "lemma ] reading Sigil1; reading2 Sigil2;"
    Returns a dict: { lemma: str, variants: { sigil: reading } }
    """
    if "]" not in line_text:
        return None

    lemma_part, variants_part = line_text.split("]", 1)
    lemma = lemma_part.strip()
    
    # Split variants by semicolon
    raw_chunks = variants_part.split(";")
    
    variants_map = {}
    current_reading = None
    
    # Heuristic: Sigils are usually the last word(s) in a chunk.
    # We assume standard format: "[Reading] Sigil"
    
    for chunk in raw_chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
            
        parts = chunk.split()
        if not parts:
            continue
            
        # The last part is definitely a sigil.
        sigil = parts[-1]
        
        # Everything before the last word is the reading.
        potential_reading = " ".join(parts[:-1])
        
        if potential_reading:
            current_reading = potential_reading
        elif current_reading is None:
            # Fallback if the first chunk has no reading, though usually apparatus
            # starts with "reading Sigil" or "om. Sigil".
            pass 
            
        variants_map[sigil] = current_reading
        
    return {
        "lemma": lemma,
        "variants": variants_map
    }

def get_word_ops(m10_text, variants_list, target_sigil):
    """
    Reconstructs the text for target_sigil based on M10 and variants.
    Returns list of WordOps.
    """
    m10_tokens = tokenize(m10_text)
    ops = []
    
    i = 0
    while i < len(m10_tokens):
        matched_variant = None
        match_length = 0
        
        # Try to find a variant starting at current token
        for v in variants_list:
            lemma_tokens = tokenize(v['lemma'])
            len_l = len(lemma_tokens)
            
            if i + len_l <= len(m10_tokens):
                # Strict token matching
                segment = m10_tokens[i : i + len_l]
                if segment == lemma_tokens:
                    # Found a lemma match in M10
                    # Check if this variant applies to target_sigil
                    if target_sigil in v['variants']:
                        matched_variant = v
                        match_length = len_l
                        break 
        
        if matched_variant:
            reading = matched_variant['variants'][target_sigil]
            base_token_str = " ".join(m10_tokens[i : i + match_length])
            
            if reading == "om.":
                ops.append({
                    "op_type": "delete",
                    "base_token": base_token_str,
                    "other_token": "",
                    "char_ops": []
                })
            else:
                ops.append({
                    "op_type": "replace",
                    "base_token": base_token_str,
                    "other_token": reading,
                    "char_ops": []
                })
            
            i += match_length
        else:
            # Equal
            ops.append({
                "op_type": "equal",
                "base_token": m10_tokens[i],
                "other_token": m10_tokens[i],
                "char_ops": []
            })
            i += 1
            
    return ops

def parse_docx_diffs(docx_path, target_sigil):
    doc = Document(docx_path)
    blocks = []
    current_block = None

    print(doc)
    
    # Regex for M10 header
    # Matches "43.1. M10: content"
    # Handles cases like "43.1. M10:" or "43.1 M10:"
    header_pattern = re.compile(r'^\d+(\.\d+)+\.?\s*M10:(.*)')
    
    for para in doc.paragraphs:
        # Check raw text first for speed/safety
        if not para.text.strip():
            continue
            
        clean_text = clean_text_from_superscripts(para)
        
        # Try to match Header
        header_match = header_pattern.match(clean_text)
        
        if header_match:
            if current_block:
                blocks.append(current_block)
            
            m10_content = header_match.group(2).strip()
            current_block = {
                "m10": m10_content,
                "variants": []
            }
        else:
            # Variant line
            # Must contain "]" to be valid variant line
            if current_block and "]" in clean_text:
                current_block["variants"].append(clean_text)
                
    if current_block:
        blocks.append(current_block)
        
    all_word_ops = []
    
    for block in blocks:
        variants_list = []
        for v_line in block['variants']:
            parsed = parse_variants_line(v_line)
            if parsed:
                variants_list.append(parsed)
        
        block_ops = get_word_ops(block['m10'], variants_list, target_sigil)
        all_word_ops.extend(block_ops)
        
    return all_word_ops

if __name__ == "__main__":
    if len(sys.argv) > 2:
        path = sys.argv[1]
        sigil = sys.argv[2]
        try:
            result = parse_docx_diffs(path, sigil)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except Exception as e:
            # Print error to stderr so it doesn't break JSON parsing if piped
            print(f"Error: {e}", file=sys.stderr)
