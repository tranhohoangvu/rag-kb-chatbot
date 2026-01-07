from pathlib import Path
from typing import List, Tuple, Optional

from pypdf import PdfReader
import docx

def parse_file(path: Path) -> List[Tuple[Optional[int], str]]:
    ext = path.suffix.lower()

    if ext == ".pdf":
        reader = PdfReader(str(path))
        pages: List[Tuple[Optional[int], str]] = []
        for i, p in enumerate(reader.pages, start=1):
            text = p.extract_text() or ""
            text = text.strip()
            if text:
                pages.append((i, text))
        return pages

    if ext == ".docx":
        d = docx.Document(str(path))
        text = "\n".join([p.text for p in d.paragraphs if p.text and p.text.strip()]).strip()
        return [(None, text)] if text else []

    if ext in [".txt", ".md"]:
        text = Path(path).read_text(encoding="utf-8", errors="ignore").strip()
        return [(None, text)] if text else []

    raise ValueError(f"Unsupported file type: {ext}")
