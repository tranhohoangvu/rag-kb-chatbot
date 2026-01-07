import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type Citation = {
  chunk_id: number;
  document_id: number;
  filename: string;
  page: number | null;
  chunk_index: number;
  snippet: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export default function App() {
  const [health, setHealth] = useState("checking...");
  const [collectionId, setCollectionId] = useState("default");

  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);

  const docsUrl = useMemo(
    () => `${API_URL}/documents?collection_id=${encodeURIComponent(collectionId)}`,
    [collectionId]
  );

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d) => setHealth(d.status ?? "unknown"))
      .catch(() => setHealth("failed"));
  }, []);

  async function onUpload() {
    if (!file) return;
    setUploadResult("");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("collection_id", collectionId);
      fd.append("file", file);

      const res = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Upload failed");

      setUploadResult(
        `Indexed: ${data.filename} | chunks: ${data.chunks_indexed} | doc_id: ${data.document_id}`
      );
    } catch (e: unknown) {
      setUploadResult(`Error: ${getErrorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function onAsk() {
    if (!question.trim()) return;
    setAnswer("");
    setCitations([]);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          collection_id: collectionId,
          top_k: 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Chat failed");

      setAnswer(data.answer ?? "");
      setCitations(data.citations ?? []);
    } catch (e: unknown) {
      setAnswer(`Error: ${getErrorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">RAG KB Chatbot</h1>
          <div className="text-sm">
            Backend: <span className="font-semibold">{health}</span>
          </div>
        </div>

        <div className="mt-4 bg-white rounded-xl shadow p-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium">Collection</label>
              <input
                className="mt-1 w-full border rounded-lg p-2"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                placeholder="default"
              />
              <div className="mt-2 text-xs text-gray-500">
                Docs:{" "}
                <a className="underline" href={docsUrl} target="_blank" rel="noreferrer">
                  {docsUrl}
                </a>
              </div>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium">Upload (.pdf/.docx/.txt/.md)</label>
              <input
                type="file"
                className="mt-1 w-full"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                disabled={!file || loading}
                onClick={onUpload}
                className="mt-2 px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
              >
                Upload & Index
              </button>
              {uploadResult && (
                <div className="mt-2 text-sm whitespace-pre-wrap">{uploadResult}</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 bg-white rounded-xl shadow p-4">
          <label className="text-sm font-medium">Ask</label>
          <div className="flex gap-2 mt-2">
            <input
              className="flex-1 border rounded-lg p-3 outline-none"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Hỏi gì đó dựa trên tài liệu..."
            />
            <button
              disabled={loading}
              onClick={onAsk}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>

          {answer && (
            <div className="mt-4">
              <div className="text-sm font-semibold">Answer</div>
              <div className="mt-2 whitespace-pre-wrap text-gray-800">{answer}</div>
            </div>
          )}

          {citations.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-semibold">Sources</div>
            <div className="mt-2 space-y-2">
              {citations.map((c) => (
                <div key={c.chunk_id} className="border rounded-lg p-3 bg-gray-50">
                  <div className="text-sm font-medium">
                    {c.filename} • doc {c.document_id}
                    {c.page != null ? ` (trang ${c.page})` : ""} • chunk {c.chunk_index}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                    {c.snippet}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Tip: Nếu muốn câu trả lời “tổng hợp” hơn, bật Ollama: set USE_OLLAMA=true trong backend/.env.
        </div>
      </div>
    </div>
  );
}
