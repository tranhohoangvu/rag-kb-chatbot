# RAG Knowledge Base Chatbot

A lightweight **Retrieval-Augmented Generation (RAG)** chatbot that lets you **upload documents**, **index them into Postgres + pgvector**, and **chat with citations**.

**Stack:** FastAPI • Postgres (pgvector) • React (Vite + TS) • Tailwind • Docker Compose

---

## Features

- Upload & index: **PDF / DOCX / TXT / MD**
- Chunking + Embeddings (local): **SentenceTransformers** (no API key required)
- Vector search in **pgvector** (cosine distance)
- Chat endpoint returns:
  - `answer`
  - `citations[]` (filename, doc_id, page, snippet)
- Optional: turn on **Ollama** for more natural “summarized” answers

---

## Repo structure

```
rag-kb-chatbot/
  backend/         # FastAPI + SQLAlchemy + pgvector + embeddings
  frontend/        # Vite React + Tailwind UI (upload + chat + citations)
  docker-compose.yml
```

---

## Requirements

- **Docker Desktop** (with WSL2 on Windows)
- **Python 3.11+**
- **Node.js 18+** (recommended)

> First time embedding model run may download a few hundred MB and take a while.

---

## Quickstart (recommended)

### 1) Configure environment

Create **`backend/.env`**:

```env
DATABASE_URL=postgresql+psycopg://rag:rag@localhost:5432/ragdb

# Embeddings (local)
EMBED_MODEL_NAME=intfloat/multilingual-e5-small
EMBED_DIM=384

# Optional: Ollama
USE_OLLAMA=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b-instruct

# Optional: reduce HF warnings
HF_HUB_DISABLE_SYMLINKS_WARNING=1
HF_HUB_DISABLE_PROGRESS_BARS=1
TOKENIZERS_PARALLELISM=false
```

Create **`frontend/.env`**:

```env
VITE_API_URL=http://127.0.0.1:8000
```

---

### 2) Start database (Postgres + pgvector)

From repo root:

```bash
docker compose up -d db
```

Enable pgvector extension (one-time per database volume):

```bash
docker exec -it rag_db psql -U rag -d ragdb -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

### 3) Run backend

```bash
cd backend
python -m venv .venv

# Windows:
.\.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open:
- Swagger UI: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`

---

### 4) Run frontend

```bash
cd frontend
npm install
npm run dev
```

Open:
- `http://localhost:5173`

---

## How to use

### Upload & index documents (UI)

In the UI:
1. Set `Collection` (default: `default`)
2. Upload `.pdf / .docx / .txt / .md`
3. Click **Upload & Index**

### Ask questions (UI)

Type a question → **Send**  
You’ll get:
- `Answer`
- `Sources` with citations

---

## API

### `GET /health`
Returns server status.

### `POST /documents/upload`
Multipart form-data:
- `collection_id`: string (default: `default`)
- `file`: PDF/DOCX/TXT/MD

Response:
```json
{
  "document_id": 1,
  "filename": "file.txt",
  "collection_id": "default",
  "chunks_indexed": 12
}
```

### `POST /chat`
JSON:
```json
{
  "question": "What is this project?",
  "collection_id": "default",
  "top_k": 4
}
```

Response:
```json
{
  "answer": "...",
  "citations": [
    {
      "chunk_id": 1,
      "document_id": 1,
      "filename": "file.txt",
      "page": null,
      "chunk_index": 0,
      "snippet": "..."
    }
  ]
}
```

### (Optional) Management endpoints
If enabled in your backend code:
- `GET /collections`
- `GET /documents?collection_id=default`

---

## Test from terminal

### PowerShell-friendly upload (curl.exe)
From repo root:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/documents/upload" `
  -F "collection_id=default" `
  -F "file=@test.txt"
```

### PowerShell-friendly chat (avoid JSON quoting issues)
```powershell
'{"question":"Câu nhắc để test tìm kiếm chính xác là gì?","collection_id":"default","top_k":4}' `
  | Set-Content -Encoding utf8 payload.json

curl.exe -X POST "http://127.0.0.1:8000/chat" `
  -H "Content-Type: application/json" `
  --data-binary "@payload.json"
```

---

## Optional: Enable Ollama (better answers)

If you don’t want to download extra models, keep `USE_OLLAMA=false` (fallback returns best snippet + citations).

If you want more natural answers:

1) Install Ollama and confirm it runs:
```bash
ollama --version
curl http://localhost:11434/api/tags
```

2) Pull a small model (example):
```bash
ollama pull qwen2.5:3b-instruct
```

3) Set in `backend/.env`:
```env
USE_OLLAMA=true
OLLAMA_MODEL=qwen2.5:3b-instruct
```

4) Restart backend.

---

## Vector index (pgvector)

For small datasets, brute-force search is fine.

For larger datasets, consider indexes:
- **HNSW** (good recall, recommended)
- **IVFFLAT** (needs more data; low recall warning with tiny tables)

Example HNSW index:

```sql
CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
ON chunks USING hnsw (embedding vector_cosine_ops)
WITH (m=16, ef_construction=64);
```

---

## Troubleshooting

### `docker : The term 'docker' is not recognized...`
Docker CLI not on PATH in Windows PowerShell.
- Restart terminal (and sometimes Windows).
- Or run Docker with full path:
  `C:\Program Files\Docker\Docker\resources\bin\docker.exe ...`

### `type "vector" does not exist`
You forgot to enable the extension:
```bash
docker exec -it rag_db psql -U rag -d ragdb -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### PowerShell JSON errors with curl
Use `payload.json` + `--data-binary "@payload.json"` (see Test section).

### HuggingFace download seems “stuck”
First run downloads the embedding model and can take time. After that it uses cache under:
`%USERPROFILE%\.cache\huggingface\hub`

---

## Roadmap (nice-to-have)

- Delete document / clear collection endpoints
- Better chunking + dedup + rerank
- HNSW indexing by default for larger KBs
- Streaming responses when Ollama is enabled

---

## License
No license is included by default. Add one if you plan to distribute publicly.
