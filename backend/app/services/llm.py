from typing import List
import httpx
from app.core.config import settings

def build_prompt(question: str, contexts: List[str]) -> str:
    ctx = "\n\n".join(contexts)
    return (
        "Bạn là trợ lý. Chỉ trả lời dựa trên CONTEXT. Nếu không đủ thông tin, nói rõ.\n"
        "Luôn trả lời tiếng Việt.\n\n"
        f"CONTEXT:\n{ctx}\n\n"
        f"QUESTION: {question}\n"
        "ANSWER:"
    )

def try_ollama(prompt: str) -> str | None:
    if not settings.USE_OLLAMA:
        return None
    url = settings.OLLAMA_BASE_URL.rstrip("/") + "/api/generate"
    payload = {"model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False}
    try:
        r = httpx.post(url, json=payload, timeout=60)
        r.raise_for_status()
        data = r.json()
        return (data.get("response") or "").strip() or None
    except Exception:
        return None
