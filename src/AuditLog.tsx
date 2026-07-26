import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./DaemonDashboard.css";

interface AuditEntry {
  timestamp?: string;
  action?: string;
  approved?: boolean;
  method?: string;
  session_id?: string;
  description?: string;
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const resp = await invoke<{ ok: boolean; entries: AuditEntry[] }>("get_audit_log", { limit: 40 });
      if (resp.ok) setEntries(resp.entries.reverse());
    } catch { /* daemon not running */ }
  }

  return (
    <div className="dash-panel">
      <h3 className="dash-title">Audit Log</h3>
      <button className="dash-btn" onClick={refresh}>Refresh</button>
      {entries.length === 0 && <div className="dash-empty">No entries</div>}
      {entries.map((e, i) => (
        <div key={i} className={`audit-entry ${e.approved ? "approved" : "denied"}`}>
          <div className="audit-action">{e.action || "?"}</div>
          <div className="audit-meta">
            {e.approved ? "✓" : "✗"} via {e.method || "?"}
            {e.description ? ` — ${e.description.slice(0, 60)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
