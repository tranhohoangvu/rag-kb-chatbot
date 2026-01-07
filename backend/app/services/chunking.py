from typing import List, Tuple, Optional, Dict, Any

def chunk_pages(
    pages: List[Tuple[Optional[int], str]],
    chunk_chars: int = 1200,
    overlap: int = 200,
) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    global_idx = 0

    for page, text in pages:
        text = " ".join(text.split())  # normalize whitespace
        if not text:
            continue

        start = 0
        while start < len(text):
            end = min(len(text), start + chunk_chars)
            content = text[start:end].strip()
            if content:
                chunks.append(
                    {
                        "page": page,
                        "chunk_index": global_idx,
                        "content": content,
                    }
                )
                global_idx += 1
            if end >= len(text):
                break
            start = max(0, end - overlap)

    return chunks
