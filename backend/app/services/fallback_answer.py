import re
from typing import List, Optional


def _norm(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\t", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def _combined(contexts: List[str]) -> str:
    return _norm("\n".join([c or "" for c in contexts]))


def _extract_between(label: str, text: str, next_labels: List[str]) -> Optional[str]:
    """
    Lấy value sau 'Label:' cho tới trước label kế tiếp.
    Chỉ dùng những gì có trong contexts, không tự bịa thông tin.
    """
    text = _norm(text)
    m = re.search(rf"(?i)\b{re.escape(label)}\b\s*:\s*", text)
    if not m:
        return None

    tail = text[m.end():]
    end = len(tail)

    for lb in next_labels:
        m2 = re.search(rf"(?i)\b{re.escape(lb)}\b\s*:\s*", tail)
        if m2:
            end = min(end, m2.start())

    val = tail[:end].strip()
    val = re.sub(r"^[\s\-\•\,\;\:\.]+", "", val).strip()
    val = re.sub(r"\s+", " ", val).strip()
    if len(val) < 3:
        return None
    return val


def _extract_arch(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    labels = ["backend", "frontend", "database", "luồng dữ liệu", "data flow"]
    backend = _extract_between("backend", text, labels)
    frontend = _extract_between("frontend", text, labels)
    database = _extract_between("database", text, labels)
    return backend, frontend, database


def _port_from(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    m = re.search(r"(?i)\bport\s*([0-9]{2,5})\b", s)
    if m:
        return m.group(1)
    m = re.search(r"\b([0-9]{2,5})\b", s)
    return m.group(1) if m else None


def _clean_parens_port(s: str) -> str:
    return re.sub(r"\(\s*port\s*([0-9]{2,5})\s*\)", r"port \1", s, flags=re.IGNORECASE)


def _find_first(pattern: str, text: str) -> Optional[str]:
    m = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    out = (m.group(1) or "").strip()
    out = re.sub(r"\s+", " ", out).strip()
    return out if out else None


def _first_snippet(contexts: List[str], max_chars: int = 420) -> str:
    if not contexts:
        return ""
    s = (contexts[0] or "").strip()
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_chars:
        s = s[:max_chars].rstrip() + "..."
    return s


def build_fallback_answer(question: str, contexts: List[str]) -> str:
    """
    Grounded/extractive answer:
    - Chỉ trả lời dựa trên contexts (retrieved chunks).
    - Không có thông tin trong contexts => nói rõ "không thấy trong tài liệu".
    """
    q = (question or "").strip().lower()
    text = _combined(contexts)

    # 1) Kiến trúc
    if any(k in q for k in ["kiến trúc", "thành phần", "architecture", "components"]):
        be, fe, db = _extract_arch(text)
        if be or fe or db:
            parts = []
            if be:
                parts.append(f"BE: {_clean_parens_port(be)}")
            if fe:
                parts.append(f"FE: {_clean_parens_port(fe)}")
            if db:
                parts.append(f"CSDL: {_clean_parens_port(db)}")
            return "Theo tài liệu, kiến trúc gồm:\n- " + "\n- ".join(parts)

        return "Mình không thấy mô tả kiến trúc (Backend/Frontend/Database) trong các đoạn trích hiện có."

    # 2) Port
    if "port" in q:
        be, fe, db = _extract_arch(text)
        p_be = _port_from(be)
        p_fe = _port_from(fe)
        p_db = _port_from(db)

        if "backend" in q:
            return f"Trong tài liệu, mình {'thấy' if p_be else 'không thấy'} port Backend" + (f": {p_be}." if p_be else ".")
        if "frontend" in q:
            return f"Trong tài liệu, mình {'thấy' if p_fe else 'không thấy'} port Frontend" + (f": {p_fe}." if p_fe else ".")
        if any(k in q for k in ["csdl", "cơ sở dữ liệu", "database", "db"]):
            return f"Trong tài liệu, mình {'thấy' if p_db else 'không thấy'} port Database" + (f": {p_db}." if p_db else ".")

        found = []
        if p_be:
            found.append(f"Backend: {p_be}")
        if p_fe:
            found.append(f"Frontend: {p_fe}")
        if p_db:
            found.append(f"Database: {p_db}")

        if found:
            return "Trong tài liệu, các port mình thấy là:\n- " + "\n- ".join(found)

        return "Mình không thấy thông tin port trong các đoạn trích hiện có."

    # 3) Endpoint /chat (nếu docs có)
    if "/chat" in q or "endpoint" in q:
        fields = _find_first(r"post\s*/chat.*?:\s*(question\s*,?\s*collection_id\s*,?\s*top_k)", text)
        if fields:
            return "Theo tài liệu, POST /chat gồm: question, collection_id, top_k."
        return "Mình không thấy mô tả endpoint /chat trong các đoạn trích hiện có."

    # 4) Hoàn tiền
    if "hoàn tiền" in q:
        refund = _find_first(r"(Hoàn tiền.*?\.)", text)
        if refund:
            return refund
        return "Mình không thấy nội dung chính sách hoàn tiền trong các đoạn trích hiện có."

    # 5) Hỗ trợ
    if any(k in q for k in ["phản hồi", "hỗ trợ", "support"]):
        resp = _find_first(r"(Thời gian phản hồi.*?\.)", text)
        if resp:
            return resp
        return "Mình không thấy thời gian phản hồi hỗ trợ trong các đoạn trích hiện có."

    # 6) Citations
    if "citations" in q or "nguồn" in q or "sources" in q:
        return "Citations giúp đối chiếu câu trả lời đang dựa vào đoạn nào trong tài liệu, để kiểm chứng và tránh hiểu nhầm."

    # Default: trả snippet liên quan nhất
    snippet = _first_snippet(contexts)
    if snippet:
        return "Mình tìm thấy đoạn liên quan nhất trong tài liệu như sau:\n\n" + snippet
    return "Mình chưa có đủ dữ liệu trong tài liệu để trả lời câu hỏi này."
