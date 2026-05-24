import docx
from docx import Document
import re
import os
import sys
from collections import defaultdict

def split_manuscripts(source_path, output_dir):
    """
    Parses a source DOCX file containing fragments from different manuscripts.
    
    Supported formats:
    1. Combined line: "43.1. M10: text"
    2. Separate lines:
       "43.1."
       "M10: text"
       "MN: text"
       
    Collects text for each sigil and saves it to a separate DOCX file in output_dir.
    """
    if not os.path.exists(source_path):
        print(f"Error: Source file not found at {source_path}")
        return

    try:
        doc = Document(source_path)
    except Exception as e:
        print(f"Error reading document: {e}")
        return

    # Dictionary to store paragraphs for each sigil
    # Key: Sigil (str)
    # Value: List of text fragments (str)
    manuscripts = defaultdict(list)

    # Regex patterns
    
    # 1. Combined: "43.1. M10: Text"
    # Matches: Number followed by Sigil: Text
    combined_pattern = re.compile(r'^\s*\d+(?:\.\d+)+\.?\s+([A-Za-z0-9а-яА-Я]+)\s*:\s*(.*)')
    
    # 2. Verse Header: "43.1." or "43.1"
    # Matches: Number only
    verse_pattern = re.compile(r'^\s*\d+(?:\.\d+)+\.?\s*$')
    
    # 3. Sigil Line: "M10: Text"
    # Matches: Sigil at start of line followed by colon and text
    sigil_pattern = re.compile(r'^\s*([A-Za-z0-9а-яА-Я]+)\s*:\s*(.*)')

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        # Try matching patterns in order of specificity
        
        # Check Combined first
        match_combined = combined_pattern.match(text)
        if match_combined:
            sigil = match_combined.group(1)
            content = match_combined.group(2).strip()
            manuscripts[sigil].append(content)
            continue
            
        # Check Verse Header (just skip/ignore as it's a separator)
        if verse_pattern.match(text):
            # Useful for context if we needed to track verse numbers, 
            # but for now we just want the text content for each sigil.
            continue
            
        # Check Sigil Line
        match_sigil = sigil_pattern.match(text)
        if match_sigil:
            sigil = match_sigil.group(1)
            content = match_sigil.group(2).strip()
            manuscripts[sigil].append(content)
            continue
            
        # If no match, it might be a continuation or unparsed line.
        # Given the strict structure, we skip it but could log a warning.
        # print(f"Skipping line: {text[:50]}...")

    if not manuscripts:
        print("No manuscripts found. Check the input file format.")
        return

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Write each manuscript to a separate DOCX file
    for sigil, fragments in manuscripts.items():
        output_path = os.path.join(output_dir, f"{sigil}.docx")
        
        new_doc = Document()
        
        for fragment in fragments:
            new_doc.add_paragraph(fragment)
            
        new_doc.save(output_path)
        print(f"Saved {sigil} to {output_path} ({len(fragments)} fragments)")

if __name__ == "__main__":
    # Default paths
    default_source = "testing/quality/data/source/Глава 43_t.docx"
    default_output = "testing/quality/data/clean"
    
    if len(sys.argv) >= 2:
        source = sys.argv[1]
    else:
        source = default_source
        
    if len(sys.argv) >= 3:
        output = sys.argv[2]
    else:
        output = default_output

    print(f"Processing {source}...")
    split_manuscripts(source, output)
