import docx
import io

def extract_paragraphs_docx(file_bytes: bytes) -> list[str]:
    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs = []
    for para in doc.paragraphs:
        text = para.text
        # Ignore blank paragraphs while preserving token content and whitespace.
        if text.strip():
            paragraphs.append(text)
    return paragraphs

def extract_paragraphs_txt(file_bytes: bytes) -> list[str]:
    # Decode utf-8
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
         # Fallback to cp1251 or others if needed, but for MVP utf-8 is standard
         text = file_bytes.decode("cp1251", errors="ignore")
    
    lines = text.replace('\r\n', '\n').split('\n')
    paragraphs = [line for line in lines if line.strip()]
    return paragraphs
