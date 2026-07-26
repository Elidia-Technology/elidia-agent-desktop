import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./RagManager.css";

interface RagSourcesResponse {
  ok: boolean;
  content: string;
}

interface RagSearchResponse {
  ok: boolean;
  content: string;
}

export default function RagManager() {
  const [sources, setSources] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => { refreshSources(); }, []);

  async function refreshSources() {
    try {
      const resp = await invoke<RagSourcesResponse>("rag_list_sources");
      if (resp.ok) setSources(resp.content);
    } catch (e) {
      setSources(`Error: ${e}`);
    }
  }

  async function doSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const resp = await invoke<RagSearchResponse>("rag_search", { query: query.trim(), limit: 5 });
      setResults(resp.content);
    } catch (e) {
      setResults(`Error: ${e}`);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="rag-panel">
      <h3 className="rag-title">RAG Document Manager</h3>

      <div className="rag-section">
        <div className="rag-label">Ingested sources</div>
        <pre className="rag-content">{sources || "Loading…"}</pre>
        <button className="rag-btn" onClick={refreshSources}>Refresh</button>
      </div>

      <div className="rag-section">
        <div className="rag-label">Search ingested content</div>
        <div className="rag-search-row">
          <input
            className="rag-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search…"
          />
          <button className="rag-btn" onClick={doSearch} disabled={searching}>
            {searching ? "…" : "Search"}
          </button>
        </div>
        {results && <pre className="rag-content">{results}</pre>}
      </div>
    </div>
  );
}
