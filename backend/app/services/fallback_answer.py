import re
from typing import List

def _find_first(pattern: str, texts: List[str]) -> str | None:
    for t in texts:
        m = re.search(pattern, t, flags=re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None

def build_fallback_answer(question: str, contexts: List[str]) -> str:
    q = question.lower()

    # 1) Kiến trúc / thành phần
    if any(k in q for k in ["kiến trúc", "thành phần", "architecture", "components"]):
        backend = _find_first(r"backend:\s*([^\n]+)", contexts)
        frontend = _find_first(r"frontend:\s*([^\n]+)", contexts)
        database = _find_first(r"database:\s*([^\n]+)", contexts)

        items = []
        if backend: items.append(f"- Backend: {backend}")
        if frontend: items.append(f"- Frontend: {frontend}")
        if database: items.append(f"- Database: {database}")

        if items:
            return "Kiến trúc dự án gồm:\n" + "\n".join(items)

    # 2) Hỏi port
    if "port" in q:
        b = _find_first(r"backend:\s*.*?\(port\s*([0-9]+)\)", contexts)
        f = _find_first(r"frontend:\s*.*?\(port\s*([0-9]+)\)", contexts)
        d = _find_first(r"database:\s*.*?\(port\s*([0-9]+)\)", contexts)

        parts = []
        if b: parts.append(f"- Backend: {b}")
        if f: parts.append(f"- Frontend: {f}")
        if d: parts.append(f"- Database: {d}")
        if parts:
            return "Các port đang dùng:\n" + "\n".join(parts)

    # 3) Hỏi endpoint /chat fields
    if "/chat" in q or "endpoint" in q:
        # cố gắng tìm dòng mô tả JSON fields
        line = _find_first(r"post\s*/chat.*?(question.*)", contexts)
        if line:
            return f"Thông tin về /chat theo tài liệu:\n{line}"

    # default: trả đoạn liên quan nhất
    best = contexts[0] if contexts else ""
    snippet = best.split("\n", 1)[-1][:300]
    return (
        "Mình chưa bật LLM để tổng hợp, nên trả về trích đoạn liên quan nhất:\n\n"
        f"{snippet}"
    )
