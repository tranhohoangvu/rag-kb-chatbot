from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.db.session import get_db
from app.db.models import Document, Chunk

from app.services.parsing import parse_file
from app.services.chunking import chunk_pages
from app.services.embeddings import embed_passages, embed_query
from app.services.fallback_answer import build_fallback_answer

router = APIRouter()

STORAGE_DIR = Path("storage")


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/collections")
def list_collections(db: Session = Depends(get_db)):
    rows = db.query(Document.collection_id).distinct().all()
    return {"collections": [r[0] for r in rows]}


@router.get("/documents")
def list_documents(collection_id: str = "default", db: Session = Depends(get_db)):
    docs = (
        db.query(Document)
        .filter(Document.collection_id == collection_id)
        .order_by(Document.id.desc())
        .all()
    )
    return {
        "collection_id": collection_id,
        "documents": [{"id": d.id, "filename": d.filename} for d in docs],
    }


@router.post("/documents/upload")
def upload_document(
    collection_id: str = Form("default"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    ext = Path(file.filename).suffix.lower()
    if ext not in [".pdf", ".docx", ".txt", ".md"]:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid4().hex}_{Path(file.filename).name}"
    save_path = STORAGE_DIR / safe_name

    data = file.file.read()
    save_path.write_bytes(data)

    try:
        pages = parse_file(save_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse failed: {e}")

    if not pages:
        raise HTTPException(status_code=400, detail="No extractable text found")

    chunks = chunk_pages(pages, chunk_chars=1200, overlap=200)
    if not chunks:
        raise HTTPException(status_code=400, detail="Chunking produced no chunks")

    texts = [c["content"] for c in chunks]
    vectors = embed_passages(texts)

    doc = Document(collection_id=collection_id, filename=file.filename)
    db.add(doc)
    db.flush()

    chunk_rows = []
    for i, c in enumerate(chunks):
        chunk_rows.append(
            Chunk(
                document_id=doc.id,
                collection_id=collection_id,
                content=c["content"],
                page=c["page"],
                chunk_index=c["chunk_index"],
                embedding=vectors[i],
            )
        )

    db.add_all(chunk_rows)
    db.commit()

    return {
        "document_id": doc.id,
        "filename": file.filename,
        "collection_id": collection_id,
        "chunks_indexed": len(chunk_rows),
    }


class ChatRequest(BaseModel):
    question: str
    collection_id: str | None = "default"
    top_k: int | None = 4


@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    q = (req.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Empty question")

    collection_id = req.collection_id or "default"
    top_k = max(1, min(int(req.top_k or 4), 10))

    qvec = embed_query(q)

    # Get both chunks + cosine distance for gating
    dist = Chunk.embedding.cosine_distance(qvec).label("distance")

    rows = (
        db.query(Chunk, Document, dist)
        .join(Document, Document.id == Chunk.document_id)
        .filter(Chunk.collection_id == collection_id)
        .filter(Chunk.embedding.isnot(None))
        .order_by(dist)
        .limit(top_k)
        .all()
    )

    if not rows:
        return {"answer": "Mình chưa tìm thấy dữ liệu phù hợp trong collection này.", "citations": []}

    best_dist = float(rows[0][2])
    if best_dist > float(settings.RAG_MAX_COSINE_DISTANCE):
        return {
            "answer": "Mình chưa tìm thấy đoạn nào đủ liên quan trong tài liệu để trả lời câu hỏi này.",
            "citations": [],
        }

    contexts: list[str] = []
    citations: list[dict] = []
    for (chunk, doc, d) in rows:
        contexts.append(chunk.content)
        citations.append(
            {
                "chunk_id": chunk.id,
                "document_id": doc.id,
                "filename": doc.filename,
                "page": chunk.page,
                "chunk_index": chunk.chunk_index,
                "distance": float(d),  # optional: giúp debug/tuning
                "snippet": chunk.content[:240] + ("..." if len(chunk.content) > 240 else ""),
            }
        )

    # "fallback" giờ là grounded/extractive (không hardcode fact nữa)
    answer = build_fallback_answer(q, contexts)
    return {"answer": answer, "citations": citations}
