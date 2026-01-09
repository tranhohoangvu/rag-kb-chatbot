# RAG Knowledge Base Chatbot

A lightweight **Retrieval-Augmented Generation (RAG)** knowledge-base chatbot that lets you:

- **Upload documents** → parse & chunk
- **Embed locally** with SentenceTransformers (no API key)
- **Store + search** in **Postgres + pgvector** (cosine distance)
- **Chat with citations** (filename/page/snippet)

> Note: the current "answer generation" step is intentionally simple/deterministic via
> `app/services/fallback_answer.py` (rule-based). Retrieval + citations are real RAG;
> you can swap in an LLM in `app/services/llm.py` when ready.

---

## Tech stack

- **Backend:** FastAPI + SQLAlchemy
- **Vector DB:** Postgres + pgvector
- **Embeddings:** SentenceTransformers (default: `intfloat/multilingual-e5-small`)
- **Frontend:** Vite + React + TypeScript + TailwindCSS
- **Dev:** Docker Compose (recommended for DB)

---

## Project structure

Below is the *meaningful* structure (generated folders like `.venv/` and `node_modules/` should be gitignored):
```text
rag-kb-chatbot/
├─ backend/
│  ├─ app/
│  │  ├─ main.py                  # FastAPI app + CORS + create tables at startup
│  │  ├─ api/
│  │  │  └─ routes.py             # /health /collections /documents /documents/upload /chat
│  │  ├─ core/
│  │  │  └─ config.py             # env settings (DATABASE_URL, EMBED_*)
│  │  ├─ db/
│  │  │  ├─ models.py             # Document, Chunk (pgvector Vector(EMBED_DIM))
│  │  │  └─ session.py            # SQLAlchemy engine + get_db()
│  │  └─ services/
│  │     ├─ parsing.py            # pdf/docx/txt/md parsing
│  │     ├─ chunking.py           # chunking (chunk_chars=1200, overlap=200)
│  │     ├─ embeddings.py         # embed_passages(), embed_query()
│  │     ├─ fallback_answer.py    # deterministic answer builder (demo)
│  │     └─ llm.py                # (placeholder) plug LLM here
│  ├─ storage/                    # uploaded files saved here
│  ├─ requirements.txt
│  └─ .env                        # local config (you create this)
│
├─ frontend/
│  ├─ src/                        # UI: upload + chat + citations
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ tailwind.config.js
│  └─ .env                        # VITE_API_URL (you create this)
│
└─ docker-compose.yml             # Postgres + pgvector (recommended)
```

---

## Demo

![RAG KB Chatbot UI](demo-ui.png)

---

## How it works (RAG pipeline)

### 1) Ingestion (Upload → Parse → Chunk → Embed → Store)

When you call `POST /documents/upload`:

- File is saved to `backend/storage/` (safe name with UUID prefix).
- Text is extracted by file type:
  - `.pdf` uses `pypdf`
  - `.docx` uses `python-docx`
  - `.txt/.md` plain text
- Text is chunked with a sliding window: `chunk_chars=1200`, `overlap=200`.
- Chunks are embedded in batch (SentenceTransformers).
- Rows are inserted into:
  - `documents` (one per file)
  - `chunks` (one per chunk, with embedding vector)

### 2) Retrieval (Embed query → Vector search)

When you call `POST /chat`:

- Question is embedded (`embed_query()`).
- Database query fetches `top_k` chunks ordered by `cosine_distance(query_vector)`.
- API returns:
  - `answer` (currently created by `build_fallback_answer()`)
  - `citations[]` (doc, page, chunk_index, snippet)

---

## Requirements

- Python 3.11+
- Node.js 18+
- Docker Desktop (recommended for Postgres)
- First run may download the embedding model (a few hundred MB).

---

## Clone & Setup (Local)

### 1) Clone repository
```bash
git clone <YOUR_REPO_URL>.git
cd rag-kb-chatbot
```

**Tip (Windows):** nếu bạn hay gặp lỗi path dài khi clone, bật:
```bash
git config --global core.longpaths true
```

### 2) Start database (Docker)
```bash
docker compose up -d db
```

Enable pgvector extension (one-time per database volume):
```bash
docker exec -it rag_db psql -U rag -d ragdb -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 3) Backend: create venv & install libraries
```bash
cd backend
python -m venv .venv
```

**Activate venv:**

- **Windows (PowerShell):**
```powershell
  .\.venv\Scripts\Activate.ps1
```

- **Windows (cmd):**
```bat
  .\.venv\Scripts\activate.bat
```

- **macOS/Linux:**
```bash
  source .venv/bin/activate
```

**Upgrade pip + install requirements:**
```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**Create `backend/.env`:**
```env
DATABASE_URL=postgresql+psycopg://rag:rag@localhost:5432/ragdb

# Embeddings (local)
EMBED_MODEL_NAME=intfloat/multilingual-e5-small
EMBED_DIM=384

# Optional: reduce HF warnings
HF_HUB_DISABLE_SYMLINKS_WARNING=1
HF_HUB_DISABLE_PROGRESS_BARS=1
TOKENIZERS_PARALLELISM=false
```

**Run backend:**
```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Open:**
- Swagger UI: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health

### 4) Frontend: install packages & run dev server
```bash
cd ../frontend
npm install
```

**Create `frontend/.env`:**
```env
VITE_API_URL=http://127.0.0.1:8000
```

**Run frontend:**
```bash
npm run dev
```

**Open:** http://localhost:5173

### 5) Quick test (optional)

**Upload a document:**
```bash
curl -X POST "http://127.0.0.1:8000/documents/upload" \
  -F "collection_id=default" \
  -F "file=@./samples/mydoc.pdf"
```

**Chat:**
```bash
curl -X POST "http://127.0.0.1:8000/chat" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is this project about?","collection_id":"default","top_k":4}'
```

---

## API

### `GET /health`
Simple server health check.

### `GET /collections`
Returns all `collection_id` values found in documents.

### `GET /documents?collection_id=default`
List documents in a collection.

### `POST /documents/upload`
Upload and index a file.

**Body:** `multipart/form-data`
- `collection_id` (optional, default=`default`)
- `file` (`.pdf/.docx/.txt/.md`)

Example:
```bash
curl -X POST "http://127.0.0.1:8000/documents/upload" \
  -F "collection_id=default" \
  -F "file=@./samples/mydoc.pdf"
```

### `POST /chat`
Ask a question (returns answer + citations).

**Request body:**
```json
{
  "question": "What is this project about?",
  "collection_id": "default",
  "top_k": 4
}
```

Example:
```bash
curl -X POST "http://127.0.0.1:8000/chat" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is this project about?","collection_id":"default","top_k":4}'
```

**Response shape:**
```json
{
  "answer": "…",
  "citations": [
    {
      "chunk_id": 123,
      "document_id": 10,
      "filename": "mydoc.pdf",
      "page": 2,
      "chunk_index": 5,
      "snippet": "…"
    }
  ]
}
```

---

## Optional: speed up vector search

For larger datasets, add a pgvector index (pick one):

**IVFFLAT** (requires ANALYZE, good for many vectors):
```sql
CREATE INDEX IF NOT EXISTS ix_chunks_embedding_ivfflat
ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**HNSW** (often great quality/speed, supports dynamic insert well):
```sql
CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
ON chunks USING hnsw (embedding vector_cosine_ops);
```

---

## Troubleshooting

- **"No extractable text found"**: PDF might be scanned (image-only). You'll need OCR.
- **"CREATE EXTENSION vector" fails**: ensure your Postgres image includes pgvector.
- **Empty results in /chat**: the collection might have no chunks indexed, or `collection_id` mismatch.
- **Slow first embedding**: model download + warm-up (normal for first run).

---

## Roadmap ideas

- Replace `fallback_answer.py` with an LLM answer generator (prompt = question + retrieved contexts).
- Add re-ranking (cross-encoder) before generation.
- Add streaming responses + chat history.
- Add document deletion / re-indexing endpoints.
- Add chunk metadata (title/section headers) & better chunking.

---

## Commit message chuẩn Conventional Commits

Bạn dùng commit này cho thay đổi README:
```bash
docs(readme): update project structure and usage guide
```