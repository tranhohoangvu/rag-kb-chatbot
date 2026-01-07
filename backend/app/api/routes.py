from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

@router.get("/health")
def health():
    return {"status": "ok"}

class ChatRequest(BaseModel):
    question: str
    collection_id: str | None = None

@router.post("/chat")
def chat(req: ChatRequest):
    # MVP stub: bước sau mới làm retrieval + LLM
    return {
        "answer": f"(stub) You asked: {req.question}",
        "citations": []
    }
