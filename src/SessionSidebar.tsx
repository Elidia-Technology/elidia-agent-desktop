import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Session { id: string; title: string; message_count: number; updated_at: string; }
interface ChatMessage { role: string; content: string; }

export default function SessionSidebar({ onLoadMessages }: { onLoadMessages: (msgs: {role:string;text:string}[]) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const resp = await invoke<{ok:boolean;sessions:Session[]}>("list_sessions");
      if (resp.ok) setSessions(resp.sessions || []);
    } catch { /* daemon not running */ }
  }

  async function loadSession(sid: string) {
    setActive(sid);
    try {
      const resp = await invoke<{ok:boolean;messages:ChatMessage[]}>("get_session_messages", {sessionId: sid});
      if (resp.ok && resp.messages) {
        onLoadMessages(resp.messages.map((m) => ({role: m.role, text: m.content})));
      }
    } catch { /* ok */ }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="sidebar-btn" onClick={refresh}>⟳</button>
      </div>
      {sessions.length === 0 && <p className="sidebar-empty">No sessions yet.</p>}
      {sessions.map((s) => (
        <div key={s.id} className={`sidebar-item ${s.id === active ? "active" : ""}`} onClick={() => loadSession(s.id)}>
          <div className="sidebar-item-title">{s.title?.slice(0, 50) || "Untitled"}</div>
          <div className="sidebar-item-meta">{s.message_count} msgs · {s.updated_at?.slice(0, 16) || ""}</div>
        </div>
      ))}
    </div>
  );
}
