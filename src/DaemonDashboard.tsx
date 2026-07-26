import { useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./DaemonDashboard.css";

interface Watcher { name: string; path: string; patterns: string[]; interval: number; }
interface Schedule { name: string; cron: string; command: string; interval_seconds: number; }
interface Webhook { name: string; path: string; port: number; }
interface DaemonConfig { watchers: Watcher[]; schedules: Schedule[]; webhooks: Webhook[]; }

export default function DaemonDashboard() {
  const [config, setConfig] = useState<DaemonConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const resp = await invoke<{ ok: boolean; config: DaemonConfig }>("get_daemon_config");
      if (resp.ok) setConfig(resp.config);
    } catch (e) { setError(String(e)); }
  }

  if (!config) return <div className="dash-panel"><p>Loading daemon config…</p><p className="dash-error">{error}</p></div>;

  return (
    <div className="dash-panel">
      <h3 className="dash-title">Daemon Dashboard</h3>
      <button className="dash-btn" onClick={refresh}>Refresh</button>

      <Section title="Watchers" items={config.watchers} render={(w: Watcher) => (
        <span>{w.name}: <code>{w.path}</code> [{w.patterns.join(", ")}] every {w.interval}s</span>
      )} />
      <Section title="Schedules" items={config.schedules} render={(s: Schedule) => (
        <span>{s.name}: <code>{s.command}</code> {s.cron ? `cron: ${s.cron}` : `every ${s.interval_seconds}s`}</span>
      )} />
      <Section title="Webhooks" items={config.webhooks} render={(w: Webhook) => (
        <span>{w.name}: :{w.port}{w.path}</span>
      )} />
    </div>
  );
}

function Section<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  return (
    <div className="dash-section">
      <div className="dash-section-title">{title} ({items.length})</div>
      {items.length === 0 && <div className="dash-empty">none configured</div>}
      {items.map((item, i) => (
        <div key={i} className="dash-item">{render(item)}</div>
      ))}
    </div>
  );
}
