import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [health, setHealth] = useState<string>("checking...");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string>("");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((d) => setHealth(d.status ?? "unknown"))
      .catch(() => setHealth("failed"));
  }, []);

  async function onAsk() {
    setAnswer("");
    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    const data = await res.json();
    setAnswer(data.answer ?? "");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">RAG KB Chatbot (MVP)</h1>
        <p className="mt-2 text-sm text-gray-600">
          Backend health: <span className="font-semibold">{health}</span>
        </p>

        <div className="mt-6 bg-white rounded-xl shadow p-4">
          <label className="text-sm font-medium">Ask</label>
          <input
            className="mt-2 w-full border rounded-lg p-3 outline-none focus:ring"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a question..."
          />
          <button
            onClick={onAsk}
            className="mt-3 px-4 py-2 rounded-lg bg-black text-white"
          >
            Send
          </button>

          {answer && (
            <div className="mt-4">
              <div className="text-sm font-semibold">Answer</div>
              <div className="mt-2 whitespace-pre-wrap text-gray-800">
                {answer}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
