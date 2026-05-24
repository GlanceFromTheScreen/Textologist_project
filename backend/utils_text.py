import docx
import io

def extract_paragraphs_docx(file_bytes: bytes) -> list[str]:
    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text: # Skip empty paragraphs? Spec says "preserve structure", but usually we want non-empty. 
                 # Spec says: "For .docx extract only paragraphs (plain paragraphs)". 
                 # "For .txt read text and split by \n (or empty lines)".
                 # I'll keep non-empty paragraphs for now as they are the semantic units.
                 # Wait, if I skip empty lines, I lose vertical spacing if it matters. 
                 # But usually empty paragraphs in docx are just spacing.
                 # Spec says "split by \n (or empty lines — choose uniformly)".
                 # I will filter out empty strings to avoid noise in comparison.
            paragraphs.append(text)
    return paragraphs

def extract_paragraphs_txt(file_bytes: bytes) -> list[str]:
    # Decode utf-8
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
         # Fallback to cp1251 or others if needed, but for MVP utf-8 is standard
         text = file_bytes.decode("cp1251", errors="ignore")
    
    lines = text.split('\n')
    paragraphs = [line.strip() for line in lines if line.strip()]
    return paragraphs
