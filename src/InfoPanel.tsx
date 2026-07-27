import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MemoryEntry { key: string; content: string; tier: string; }
interface PersonaEntry { slug: string; name?: string; description?: string; }
type Section = "memory" | "mcp" | "personas" | "models" | "trust" | "balance";

export default function InfoPanel() {
  const [section, setSection] = useState<Section>("memory");
  const [data, setData] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadSection(section); }, [section]);

  async function loadSection(s: Section) {
    setLoading(true);
    try {
      switch (s) {
        case "memory":
          setData(await invoke("search_memory", { query: null, limit: 30 })); break;
        case "mcp":
          setData(await invoke("list_mcp_servers")); break;
        case "personas":
          setData(await invoke("list_personas")); break;
        case "models":
          setData(await invoke("list_models")); break;
        case "trust":
          setData(await invoke("get_trust_stats")); break;
        case "balance":
          setData(await invoke("get_balance")); break;
      }
    } catch (e) { setData({ error: String(e) }); }
    finally { setLoading(false); }
  }

  async function doSearchMemory() {
    setData(await invoke("search_memory", { query: query || null, limit: 30 }));
  }
  async function doForget(key: string) {
    await invoke("forget_memory", { key });
    loadSection("memory");
  }

  const sections: { key: Section; label: string; emoji: string }[] = [
    { key: "memory", label: "Memory", emoji: "🧠" },
    { key: "mcp", label: "MCP", emoji: "🔌" },
    { key: "personas", label: "Personas", emoji: "🎭" },
    { key: "models", label: "Models", emoji: "🤖" },
    { key: "trust", label: "Trust", emoji: "🛡" },
    { key: "balance", label: "Balance", emoji: "💰" },
  ];

  return (
    <div className="info-panel">
      <div className="info-tabs">
        {sections.map((s) => (
          <button key={s.key} className={`info-tab ${section === s.key ? "active" : ""}`}
            onClick={() => setSection(s.key)} title={s.label}>
            {s.emoji}
          </button>
        ))}
      </div>

      <div className="info-body">
        {loading && <p className="info-loading">Loading…</p>}

        {section === "memory" && data?.entries && (
          <div>
            <div className="info-search-row">
              <input className="info-input" placeholder="Search memories…" value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearchMemory()} />
              <button className="info-btn" onClick={doSearchMemory}>Search</button>
            </div>
            {data.entries.map((m: MemoryEntry, i: number) => (
              <div key={i} className="info-item">
                <div className="info-item-top">
                  <span className="info-key">{m.key}</span>
                  <span className="info-tier">{m.tier}</span>
                  <button className="info-del" onClick={() => doForget(m.key)}>✕</button>
                </div>
                <div className="info-content">{m.content}</div>
              </div>
            ))}
            {data.entries.length === 0 && <p className="info-empty">No memories yet.</p>}
          </div>
        )}

        {section === "mcp" && (
          <div>
            {data?.servers && Object.keys(data.servers).length > 0 ? (
              Object.entries(data.servers as Record<string, number>).map(([name, count]) => (
                <div key={name} className="info-item">
                  <span className="info-key">{name}</span>
                  <span className="info-sub">{count} tools</span>
                </div>
              ))
            ) : (
              <p className="info-empty">{data?.error || "No MCP servers connected."}</p>
            )}
          </div>
        )}

        {section === "personas" && data?.personas && (
          <div>
            {data.personas.map((p: PersonaEntry, i: number) => (
              <div key={i} className="info-item">
                <span className="info-key">{p.slug}</span>
                {p.name && <span className="info-sub">{p.name}</span>}
              </div>
            ))}
          </div>
        )}

        {section === "models" && data?.models && (
          <div>
            {Object.entries(data.models as Record<string, string>).map(([task, model]) => (
              <div key={task} className="info-item">
                <span className="info-key">{task}</span>
                <code className="info-model">{model}</code>
              </div>
            ))}
          </div>
        )}

        {section === "trust" && (
          <div>
            {data?.promoted_actions?.length > 0 ? (
              data.promoted_actions.map((a: string, i: number) => (
                <div key={i} className="info-item"><span className="info-key">{a}</span></div>
              ))
            ) : (
              <p className="info-empty">{data?.note || "No promoted actions yet."}</p>
            )}
          </div>
        )}

        {section === "balance" && data?.balance && (
          <div className="info-balance">
            <div className="balance-big">{Number(data.balance.balance_dt || 0).toLocaleString()} DT</div>
            <div className="balance-sub">${(Number(data.balance.balance_dt || 0) / 1000).toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
