import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function SettingsPanel() {
  const [tab, setTab] = useState<"models" | "mcp" | "budget" | "permissions" | "skills" | "gateway">("models");
  const [models, setModels] = useState<Array<{id:string;owned_by:string}>>([]);
  const [mcpServers, setMcpServers] = useState<Record<string,number>>({});
  const [balance, setBalance] = useState<Record<string,unknown>>({});

  useEffect(() => { load(); }, [tab]);

  async function load() {
    try {
      if (tab === "models") {
        const r = await invoke<{ok:boolean;models:Array<{id:string;owned_by:string}>}>("list_available_models");
        if (r.ok) setModels(r.models || []);
      } else if (tab === "mcp") {
        const r = await invoke<{ok:boolean;servers:Record<string,number>}>("list_mcp_servers");
        if (r.ok) setMcpServers(r.servers || {});
      } else if (tab === "budget") {
        const r = await invoke<{ok:boolean;balance:Record<string,unknown>}>("get_balance");
        if (r.ok) setBalance(r.balance || {});
      }
    } catch { /* daemon not running */ }
  }

  return (
    <div className="settings-panel">
      <h3>⚙ Settings</h3>
      <div className="settings-tabs">
        {(["models","mcp","budget","permissions","skills","gateway"] as const).map(t => (
          <button key={t} className={`settings-tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "models" && (
        <div>
          <p className="settings-hint">Available models via AiUtils API. Set default with: elidia config set models.default &lt;id&gt;</p>
          {models.map(m => (
            <div key={m.id} className="settings-item"><span className="settings-key">{m.id}</span><span className="settings-val">@{m.owned_by}</span></div>
          ))}
        </div>
      )}

      {tab === "mcp" && (
        <div>
          <p className="settings-hint">MCP servers configured in ~/.elidia/mcp.json</p>
          {Object.keys(mcpServers).length > 0 ? Object.entries(mcpServers).map(([name,count]) => (
            <div key={name} className="settings-item"><span className="settings-key">{name}</span><span className="settings-val">{count} tools</span></div>
          )) : <p className="settings-empty">No MCP servers connected.</p>}
        </div>
      )}

      {tab === "budget" && (
        <div>
          <p className="settings-hint">Credit balance. Set limit: elidia config set budget.session_limit_dt &lt;amount&gt;</p>
          {balance.balance_dt !== undefined && (
            <div className="settings-big">{Number(balance.balance_dt).toLocaleString()} DT (${(Number(balance.balance_dt)/1000).toFixed(2)})</div>
          )}
        </div>
      )}

      {tab === "permissions" && (
        <div>
          <p className="settings-hint">4-tier permission system. Config via: elidia config set permissions.auto_approve_commands true</p>
          <div className="settings-item"><span className="settings-key">AUTO</span><span className="settings-val">file reads, web search, model calls</span></div>
          <div className="settings-item"><span className="settings-key">SESSION</span><span className="settings-val">file writes, shell commands</span></div>
          <div className="settings-item"><span className="settings-key">EVERY TIME</span><span className="settings-val">file delete, git push, db query, email send</span></div>
          <div className="settings-item"><span className="settings-key">NEVER</span><span className="settings-val">keychain access, system security</span></div>
        </div>
      )}
      {tab === "skills" && (
        <div>
          <p className="settings-hint">Activate skill prompts for the agent. Skills inject expert guidance into the system prompt.</p>
          <div className="settings-item"><span className="settings-key">software-development</span><span className="settings-val">clean code, testing, git</span></div>
          <div className="settings-item"><span className="settings-key">code-review</span><span className="settings-val">structured review checklist</span></div>
          <div className="settings-item"><span className="settings-key">testing</span><span className="settings-val">test quality + coverage</span></div>
          <div className="settings-item"><span className="settings-key">research</span><span className="settings-val">5-stage research pipeline</span></div>
          <div className="settings-item"><span className="settings-key">creative</span><span className="settings-val">content generation</span></div>
          <div className="settings-item"><span className="settings-key">data-analysis</span><span className="settings-val">data exploration + viz</span></div>
          <p className="settings-hint">Use /skill &lt;name&gt; in chat to activate. Create bundles in ~/.elidia/skill-bundles/</p>
        </div>
      )}
      {tab === "gateway" && (
        <div>
          <p className="settings-hint">Gateway Server enables remote access to the Elidia daemon via WebSocket + REST API.</p>
          <div className="settings-item"><span className="settings-key">Default Port</span><span className="settings-val">9005</span></div>
          <div className="settings-item"><span className="settings-key">WebSocket</span><span className="settings-val">ws://host:9005/ws</span></div>
          <div className="settings-item"><span className="settings-key">API</span><span className="settings-val">POST /api/v1/chat</span></div>
          <div className="settings-item"><span className="settings-key">Auth</span><span className="settings-val">Bearer token</span></div>
          <p className="settings-hint">Start via CLI: elidia gateway start or /gateway in chat</p>
        </div>
      )}
    </div>
  );
}
