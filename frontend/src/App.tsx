import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type Citation = {
  chunk_id: number;
  document_id: number;
  filename: string;
  page: number | null;
  chunk_index: number;
  snippet: string;
  distance?: number; // backend gửi optional để debug/tuning
};

type DocItem = { id: number; filename: string };
type ChatMsg =
  | { id: string; role: "user"; content: string; createdAt: number }
  | {
      id: string;
      role: "assistant";
      content: string;
      citations: Citation[];
      createdAt: number;
    };

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"] as const;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function genId() {
  // crypto.randomUUID() ok trên Chrome/Edge mới; fallback để an toàn
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // crypto.randomUUID not available, fall back to timestamp-based ID
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function StatusPill({ status }: { status: string }) {
  const isOk = status === "ok";
  const isChecking = status === "checking...";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
        isChecking && "bg-gray-100 text-gray-700",
        isOk && "bg-emerald-100 text-emerald-800",
        !isOk && !isChecking && "bg-rose-100 text-rose-800"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isChecking && "bg-gray-400",
          isOk && "bg-emerald-500",
          !isOk && !isChecking && "bg-rose-500"
        )}
      />
      {isOk ? "Backend OK" : isChecking ? "Checking" : "Backend down"}
    </span>
  );
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState("checking...");
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionId, setCollectionId] = useState("default");

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string>("");

  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const [topK, setTopK] = useState(4);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const docsUrl = useMemo(
    () => `${API_URL}/documents?collection_id=${encodeURIComponent(collectionId)}`,
    [collectionId]
  );

  // Health check (startup + poll)
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        const data = await safeJson(res);
        if (!alive) return;
        setHealth(data?.status ?? (res.ok ? "ok" : "failed"));
      } catch {
        if (!alive) return;
        setHealth("failed");
      }
    };
    run();
    const t = window.setInterval(run, 10_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Load collections once (best-effort)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/collections`);
        const data = await safeJson(res);
        if (res.ok) setCollections(Array.isArray(data?.collections) ? data.collections : []);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Load documents when collection changes
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setDocsError("");
      setDocsLoading(true);
      try {
        const res = await fetch(docsUrl, { signal: controller.signal });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data?.detail || "Failed to load documents");
        setDocs(Array.isArray(data?.documents) ? data.documents : []);
      } catch (e: unknown) {
        if ((e as Error)?.name === "AbortError") return;
        setDocs([]);
        setDocsError(getErrorMessage(e));
      } finally {
        setDocsLoading(false);
      }
    };
    const t = window.setTimeout(load, 250); // debounce typing
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [docsUrl]);

  // Keep chat scrolled to bottom on new messages
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, asking]);

  function pickFile(f: File | null) {
    setFile(f);
    setUploadResult("");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = (e as DragEvent).dataTransfer?.files?.[0] ?? null;
    if (f) pickFile(f);
  }

  async function onUpload() {
    if (!file) return;
    setUploadResult("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("collection_id", collectionId);
      fd.append("file", file);

      const res = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.detail || "Upload failed");

      setUploadResult(
        `Indexed: ${data.filename} | chunks: ${data.chunks_indexed} | doc_id: ${data.document_id}`
      );
      setToast({ kind: "ok", text: "Upload & indexing done" });

      // optimistic refresh docs list
      setDocs((prev) => [{ id: data.document_id, filename: data.filename }, ...prev]);

      // clear file
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      setUploadResult(`Error: ${msg}`);
      setToast({ kind: "err", text: msg });
    } finally {
      setUploading(false);
    }
  }

  async function onAsk() {
    const q = question.trim();
    if (!q || asking) return;

    const userMsg: ChatMsg = {
      id: genId(),
      role: "user",
      content: q,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setAsking(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          collection_id: collectionId,
          top_k: topK,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.detail || "Chat failed");

      const assistantMsg: ChatMsg = {
        id: genId(),
        role: "assistant",
        content: String(data?.answer ?? ""),
        citations: Array.isArray(data?.citations) ? data.citations : [],
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      const assistantMsg: ChatMsg = {
        id: genId(),
        role: "assistant",
        content: `Error: ${msg}`,
        citations: [],
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setToast({ kind: "err", text: msg });
    } finally {
      setAsking(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "ok", text: "Copied" });
    } catch {
      setToast({ kind: "err", text: "Copy failed" });
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Toast */}
      {toast ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
          <div
            className={cn(
              "rounded-full border px-4 py-2 text-sm shadow-sm",
              toast.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            )}
          >
            {toast.text}
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-3 py-1 text-xs text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Grounded RAG (pgvector + extractive fallback)
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-900">
              RAG KB Chatbot
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Upload tài liệu, index vào collection, rồi chat có citation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => copy(API_URL)}
              className="hidden rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm hover:bg-gray-50 sm:inline-flex"
              title="Copy API URL"
            >
              API: {API_URL}
            </button>
            <StatusPill status={health} />
          </div>
        </div>

        {/* Main */}
        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          {/* Left column */}
          <div className="space-y-6 lg:col-span-2">
            <Card
              title="Workspace"
              subtitle="Collection + retrieval settings"
              right={
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Open docs
                </a>
              }
            >
              <label className="text-xs font-medium text-gray-700">Collection</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                placeholder="default"
                list="collections"
              />
              <datalist id="collections">
                {collections.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">top_k</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={topK}
                      onChange={(e) => setTopK(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="w-8 text-right text-xs font-semibold text-gray-700">
                      {topK}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Docs URL</label>
                  <button
                    onClick={() => copy(docsUrl)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 shadow-sm hover:bg-gray-50"
                    title="Copy documents URL"
                  >
                    {docsUrl}
                  </button>
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Tip: gõ collection mới để tách data theo từng nhóm.
              </div>
            </Card>

            <Card
              title="Upload & Index"
              subtitle="Supported: .pdf / .docx / .txt / .md"
              right={
                <button
                  disabled={!file || uploading}
                  onClick={onUpload}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm",
                    !file || uploading ? "bg-gray-400" : "bg-gray-900 hover:bg-black"
                  )}
                >
                  {uploading ? "Indexing..." : "Upload"}
                </button>
              }
            >
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className={cn(
                  "rounded-2xl border-2 border-dashed p-4",
                  file ? "border-indigo-300 bg-indigo-50/60" : "border-gray-200 bg-gray-50"
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {file ? file.name : "Kéo thả file vào đây"}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600">
                      {file
                        ? `${file.type || "unknown"} • ${formatBytes(file.size)}`
                        : "Hoặc chọn file từ máy (1 file/lần)"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="text-sm"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                      disabled={uploading}
                    />
                    {file ? (
                      <button
                        onClick={() => pickFile(null)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        disabled={uploading}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {uploadResult ? (
                <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800">
                  <div className="whitespace-pre-wrap">{uploadResult}</div>
                </div>
              ) : null}
            </Card>

            <Card
              title="Documents"
              subtitle={docsLoading ? "Loading..." : `${docs.length} file(s) in collection`}
              right={
                <button
                  onClick={() => {
                    setDocsLoading(true);
                    fetch(docsUrl)
                      .then(async (r) => {
                        const d = await safeJson(r);
                        if (!r.ok) throw new Error(d?.detail || "Failed to load documents");
                        setDocs(Array.isArray(d?.documents) ? d.documents : []);
                        setDocsError("");
                      })
                      .catch((e) => setDocsError(getErrorMessage(e)))
                      .finally(() => setDocsLoading(false));
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Refresh
                </button>
              }
            >
              {docsError ? (
                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {docsError}
                </div>
              ) : null}

              {docs.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  Chưa có tài liệu nào. Upload file để bắt đầu.
                </div>
              ) : (
                <div className="space-y-2">
                  {docs.slice(0, 8).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {d.filename}
                        </div>
                        <div className="text-xs text-gray-500">doc_id: {d.id}</div>
                      </div>
                      <button
                        onClick={() => copy(d.filename)}
                        className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                  {docs.length > 8 ? (
                    <div className="text-xs text-gray-500">
                      +{docs.length - 8} file(s) nữa (xem full ở “Open docs”).
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          </div>

          {/* Right column */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Chat</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Collection: <span className="font-medium">{collectionId || "default"}</span>
                    {docs.length ? (
                      <>
                        {" "}• Docs: <span className="font-medium">{docs.length}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMessages([])}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm hover:bg-gray-50"
                    disabled={asking || uploading || messages.length === 0}
                    title="Clear chat"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => copy(JSON.stringify(messages, null, 2))}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm hover:bg-gray-50"
                    disabled={messages.length === 0}
                    title="Copy chat JSON"
                  >
                    Export
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={chatScrollRef} className="max-h-[540px] space-y-3 overflow-auto p-4">
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
                    <div className="text-sm font-semibold text-gray-900">Bắt đầu nhanh</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      <li>Upload tài liệu vào đúng collection.</li>
                      <li>Hỏi câu hỏi dựa trên nội dung tài liệu.</li>
                      <li>Mở “Sources” để xem snippet trích dẫn.</li>
                    </ul>
                  </div>
                ) : null}

                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} onCopy={copy} />
                ))}

                {asking ? (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
                    Đang tạo câu trả lời...
                  </div>
                ) : null}
              </div>

              {/* Composer */}
              <div className="border-t border-gray-100 p-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <textarea
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none ring-indigo-500 focus:ring-2"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Hỏi gì đó dựa trên tài liệu… (Enter để gửi, Shift+Enter để xuống dòng)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          onAsk();
                        }
                      }}
                      disabled={asking}
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <div>
                        top_k: <span className="font-medium text-gray-700">{topK}</span>
                      </div>
                      <div>{question.trim().length} chars</div>
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      onClick={onAsk}
                      disabled={asking || !question.trim()}
                      className={cn(
                        "h-11 rounded-2xl px-5 text-sm font-semibold text-white shadow-sm",
                        asking || !question.trim()
                          ? "bg-indigo-300"
                          : "bg-indigo-600 hover:bg-indigo-700"
                      )}
                    >
                      {asking ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          Tip: Nếu câu trả lời “không đủ liên quan”, thử đổi câu hỏi hoặc upload thêm tài liệu vào cùng collection.
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onCopy,
}: {
  msg: ChatMsg;
  onCopy: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "w-full max-w-[720px] rounded-2xl border px-4 py-3 shadow-sm",
          isUser ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-semibold text-gray-700">
            {isUser ? "You" : "Assistant"}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">{time}</div>
            <button
              onClick={() => onCopy(msg.content)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              title="Copy message"
            >
              Copy
            </button>
          </div>
        </div>

        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
          {msg.content}
        </div>

        {msg.role === "assistant" ? (
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-sm font-semibold text-gray-800">
              Sources ({msg.citations.length})
            </summary>
            {msg.citations.length === 0 ? (
              <div className="mt-2 text-sm text-gray-600">No citations returned.</div>
            ) : (
              <div className="mt-2 space-y-2">
                {msg.citations.map((c) => (
                  <div
                    key={c.chunk_id}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                      <span className="font-semibold text-gray-800">{c.filename}</span>
                      <span className="text-gray-400">•</span>
                      <span>doc {c.document_id}</span>
                      {c.page != null ? (
                        <>
                          <span className="text-gray-400">•</span>
                          <span>trang {c.page}</span>
                        </>
                      ) : null}
                      <span className="text-gray-400">•</span>
                      <span>chunk {c.chunk_index}</span>
                      {typeof c.distance === "number" ? (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className="font-mono">dist {c.distance.toFixed(4)}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                      {c.snippet}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </details>
        ) : null}
      </div>
    </div>
  );
}
