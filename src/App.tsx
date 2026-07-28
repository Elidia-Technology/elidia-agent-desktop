import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import {
  MessageSquare, Code, Search, Brain, Sparkles, FolderOpen,
  Settings, Sun, Moon, Monitor, Paperclip, Mic, Camera,
  Sidebar, PanelRight, Plus, RefreshCw, Wrench, Shield,
  BookOpen, BarChart3, Zap, Activity, Database, Terminal,
} from "lucide-react";
import RagManager from "./RagManager";
import DaemonDashboard from "./DaemonDashboard";
import AuditLog from "./AuditLog";
import WorkflowBuilder from "./WorkflowBuilder";
import InfoPanel from "./InfoPanel";
import AdvancedPanel from "./AdvancedPanel";
import SessionSidebar from "./SessionSidebar";
import Onboarding from "./Onboarding";
import SettingsPanel from "./SettingsPanel";
import "./App.css";

interface ChatEvent { event: string; data: unknown; }
interface ToolCallData { name: string; arguments: Record<string, unknown>; }
interface ToolResultData { name: string; content: string; }
type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool-call"; name: string; args: Record<string, unknown> }
  | { role: "tool-result"; name: string; content: string }
  | { role: "thinking"; model: string };

const MODES = ["chat", "code", "research", "think", "create"];

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("elidia-theme") as "light" | "dark" || "light");
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState("auto");
  const [availableModels, setAvailableModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [mode, setMode] = useState("chat");
  const [thinking, setThinking] = useState("medium");
  const [totalCost, setTotalCost] = useState(0);

  // Panel visibility
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [permRequest, setPermRequest] = useState<{ id: string; description?: string } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("elidia-onboarded"));
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Attachments
  const [attachments, setAttachments] = useState<Array<{name:string;size_formatted:string;path:string;mime_type:string}>>([]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("elidia-theme", theme); }, [theme]);
  function toggleTheme() { setTheme((t) => (t === "light" ? "dark" : "light")); }

  function finishOnboarding() { localStorage.setItem("elidia-onboarded", "1"); setShowOnboarding(false); }
  function handleLoadMessages(msgs: { role: string; text: string }[]) {
    setMessages(msgs.map((m) => (m.role === "user" ? { role: "user" as const, text: m.text } : { role: "assistant" as const, text: m.text })));
  }

  async function checkBalance() {
    try {
      const resp = await invoke<{ ok: boolean; balance: Record<string, unknown> }>("get_balance");
      if (resp.ok && resp.balance) setTotalCost(Number(resp.balance.balance_dt || 0));
    } catch { }
  }

  useEffect(() => {
    async function loadModels() {
      try {
        const resp = await invoke<{ ok: boolean; models: Array<{ id: string; owned_by: string; label: string; is_free: boolean; cost_tier: string; supports_vision: boolean }> }>("list_available_models");
        if (resp.ok && resp.models) setAvailableModels(resp.models);
      } catch { }
    }
    loadModels();
  }, [daemonRunning]);

  useEffect(() => {
    checkDaemon();
    checkBalance();
    requestNotificationPermission();
    const unlisten2 = listen<{ id: string }>("permission-request", (event) => setPermRequest({ id: event.payload.id }));
    const unlisten = listen<ChatEvent>("chat-event", (event) => {
      const { event: kind, data } = event.payload;
      switch (kind) {
        case "thinking": setMessages((prev) => [...prev, { role: "thinking", model: String((data as Record<string, unknown>)?.model ?? "auto") }]); break;
        case "tool_call": { const tc = data as ToolCallData; setMessages((prev) => [...prev, { role: "tool-call", name: tc.name, args: tc.arguments }]); break; }
        case "tool_result": { const tr = data as ToolResultData; setMessages((prev) => [...prev, { role: "tool-result", name: tr.name, content: tr.content }]); break; }
        case "content": setMessages((prev) => [...prev, { role: "assistant", text: String(data) }]); break;
        case "done": setSending(false); break;
        case "error": setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${data}` }]); setSending(false); break;
      }
    });
    return () => { unlisten.then((fn) => fn()); unlisten2.then((fn) => fn()); };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function checkDaemon() {
    try { const status = await invoke<{ running: boolean }>("daemon_status"); setDaemonRunning(status.running); }
    catch { setDaemonRunning(false); }
  }

  async function requestNotificationPermission() {
    try { let g = await isPermissionGranted(); if (!g) { const p = await requestPermission(); g = p === "granted"; } }
    catch { }
  }

  function togglePanel(panel: string) {
    if (activePanel === panel) { closePanel(); }
    else { setActivePanel(panel); setShowRightPanel(true); }
  }
  function closePanel() { setActivePanel(null); setShowRightPanel(false); }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
    const hasAttachments = attachments.length > 0;
    const displayText = text + (hasAttachments ? `\n\n[Attached: ${attachments.map(a => a.name).join(", ")}]` : "");
    setInput(""); setSending(true);
    setMessages((prev) => [...prev, { role: "user", text: displayText }]);
    setAttachments([]);
    try { await invoke("send_chat", { message: displayText, mode, model: model === "auto" ? null : model }); }
    catch (e) { setMessages((prev) => [...prev, { role: "assistant", text: `Failed: ${e}` }]); setSending(false); }
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function onDragLeave() { setDragOver(false); }
  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setInput("[Voice not supported]"); return; }
    const rec = new SpeechRecognition(); rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = (e: any) => { setInput((prev) => prev + (prev ? " " : "") + e.results[0][0].transcript); setListening(false); };
    rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
    recognitionRef.current = rec; rec.start(); setListening(true);
  }
  async function captureScreen() {
    try { const path = await invoke<string>("take_screenshot"); setInput((prev) => prev + (prev ? " " : "") + `[Screenshot: ${path}]`); }
    catch (e) { setInput(`[Screenshot failed: ${e}]`); }
  }
  async function respondPermission(approved: boolean) {
    if (!permRequest) return;
    try { await invoke("respond_permission", { id: permRequest.id, approved }); } catch { }
    setPermRequest(null);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    attachFilesFromDrop(files);
  }

  async function attachFilesFromDrop(files: FileList | File[]) {
    const filePaths: string[] = [];
    for (const f of Array.from(files)) {
      // For Tauri webview, files may not have a path. Use the file name as reference.
      if ((f as any).path) { filePaths.push((f as any).path); }
    }
    if (filePaths.length === 0) {
      setInput((prev) => prev + (prev ? "\n" : "") + `[Attached: ${Array.from(files).map(f => f.name).join(", ")}]`);
      return;
    }
    try {
      const resp = await invoke<{ok:boolean;files:Array<{name:string;size_formatted:string;path:string;mime_type:string}>;error?:string}>("attach_files", { files: filePaths });
      if (resp.ok && resp.files) {
        setAttachments((prev) => [...prev, ...resp.files].slice(0, 10));
      } else if (resp.error) {
        setInput((prev) => prev + (prev ? "\n" : "") + `[Error: ${resp.error}]`);
      }
    } catch {
      setInput((prev) => prev + (prev ? "\n" : "") + `[Attached: ${Array.from(files).map(f => f.name).join(", ")}]`);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  const ToolbarBtn = ({ icon: Icon, label, onClick, active }: { icon: any; label: string; onClick: () => void; active?: boolean }) => (
    <button className={`toolbar-btn${active ? " active" : ""}`} onClick={onClick} title={label}>
      <Icon size={17} />
    </button>
  );

  return (
    <main className="chat-app" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {showOnboarding && <Onboarding onDone={finishOnboarding} />}
      {dragOver && <div className="drop-overlay">Drop files to attach</div>}

      {/* ═══ Title Bar ═══ */}
      <div className="titlebar">
        <div className="titlebar-left">
          <img src="/elidia-icon.png" alt="" className="titlebar-icon" />
          <span className="titlebar-title">Elidia Agent</span>
        </div>
        <div className="titlebar-center">
          <span className={`daemon-dot ${daemonRunning ? "on" : daemonRunning === false ? "off" : "unknown"}`} />
          <span className="daemon-label">{daemonRunning ? "Connected" : daemonRunning === false ? "Disconnected" : "Checking…"}</span>
        </div>
        <div className="titlebar-right">
          {totalCost > 0 && <span className="cost-label">{totalCost.toLocaleString()} DT</span>}
        </div>
      </div>

      {/* ═══ Toolbar ═══ */}
      <div className="toolbar">
        <div className="toolbar-group">
          <ToolbarBtn icon={MessageSquare} label="New Chat" onClick={() => { setMessages([]); }} />
          <ToolbarBtn icon={Sidebar} label="Toggle Sessions" onClick={() => setShowSidebar(!showSidebar)} active={showSidebar} />
          <ToolbarBtn icon={PanelRight} label="Toggle Panel" onClick={() => setShowRightPanel(!showRightPanel)} active={showRightPanel} />
        </div>
        <div className="toolbar-group">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="tb-select" title="Mode">
            {MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="tb-select" title="Model" style={{ minWidth: 140 }}>
            <option value="auto">🤖 auto (best pick)</option>
            {availableModels.length > 0 ? (() => {
              const vendors = [...new Set(availableModels.map(m => m.owned_by))];
              return vendors.map(v => (
                <optgroup key={v} label={v}>
                  {availableModels.filter(m => m.owned_by === v).map(m => (
                    <option key={m.id} value={m.id}>{m.label || m.id.split('/').pop()}{m.is_free ? ' (free)' : ''}</option>
                  ))}
                </optgroup>
              ));
            })() : <>
              <option value="deepseek/deepseek-chat">DeepSeek Chat</option>
              <option value="anthropic/claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="openai/gpt-4o">GPT-4o</option>
              <option value="local/qwen2.5:7b">Qwen 2.5 7B (free)</option>
            </>}
          </select>
          <select value={thinking} onChange={(e) => setThinking(e.target.value)} className="tb-select tb-select-sm" title="Thinking">
            <option value="low">low</option><option value="medium">med</option><option value="high">high</option><option value="deep">deep</option>
          </select>
        </div>
        <div className="toolbar-group">
          <ToolbarBtn icon={BookOpen} label="RAG Manager" onClick={() => togglePanel("rag")} active={activePanel === "rag"} />
          <ToolbarBtn icon={Activity} label="Daemon Dashboard" onClick={() => togglePanel("dash")} active={activePanel === "dash"} />
          <ToolbarBtn icon={Shield} label="Audit Log" onClick={() => togglePanel("audit")} active={activePanel === "audit"} />
          <ToolbarBtn icon={Zap} label="Workflow Builder" onClick={() => togglePanel("wf")} active={activePanel === "wf"} />
          <ToolbarBtn icon={Brain} label="Advanced" onClick={() => togglePanel("adv")} active={activePanel === "adv"} />
          <ToolbarBtn icon={Settings} label="Settings" onClick={() => togglePanel("settings")} active={activePanel === "settings"} />
          <ToolbarBtn icon={RefreshCw} label="Refresh Daemon" onClick={checkDaemon} />
        </div>
        <div className="toolbar-group toolbar-end">
          <ToolbarBtn icon={theme === "light" ? Moon : Sun} label={theme === "light" ? "Dark Mode" : "Light Mode"} onClick={toggleTheme} />
        </div>
      </div>

      {/* ═══ Body ═══ */}
      <div className="app-body">
        {showSidebar && <SessionSidebar onLoadMessages={handleLoadMessages} />}

        <div className="chat-column">
          {/* Messages */}
          <div className="message-list">
            {/* Hidden file input for picker */}
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.ppt,.pptx,.csv,.txt,.md,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.json,.xml,.yaml,.yml,.toml,.py,.js,.ts,.sql,.r,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.scss,.html,.log,.env"
              onChange={(e) => { if (e.target.files) attachFilesFromDrop(e.target.files); e.target.value = ""; }} />
            {messages.length === 0 && attachments.length === 0 && (
              <div className="empty-state">
                <img src="/elidia-icon.png" alt="" className="empty-icon" />
                <p>Elidia Agent Desktop</p>
                <p className="sub">
                  Your AI workspace — chat, code, analyze, create.<br />
                  {!daemonRunning && <>Run <code>elidia daemon start</code> to connect.</>}
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                {msg.role === "user" && <div className="bubble user-bubble">{msg.text}</div>}
                {msg.role === "assistant" && <div className="bubble assistant-bubble">{msg.text}</div>}
                {msg.role === "tool-call" && (
                  <div className="tool-card"><Wrench size={13} /><span className="tool-name">{msg.name}({JSON.stringify(msg.args)})</span></div>
                )}
                {msg.role === "tool-result" && (
                  <div className="tool-card result"><Database size={13} /><span className="tool-content">{msg.content.slice(0, 200)}</span></div>
                )}
                {msg.role === "thinking" && (
                  <div className="thinking-line"><Brain size={13} /> thinking with {msg.model}…</div>
                )}
              </div>
            ))}
            {sending && <div className="message assistant"><div className="bubble assistant-bubble typing">…</div></div>}
            <div ref={endRef} />
          </div>

          {/* Attachment preview */}
          {attachments.length > 0 && (
            <div className="attachment-bar">
              {attachments.map((a, i) => (
                <span key={i} className="attachment-chip" title={a.path}>
                  {a.mime_type?.startsWith("image/") ? "🖼" : "📄"} {a.name}
                  <small>{a.size_formatted}</small>
                  <button type="button" className="attachment-remove" onClick={() => removeAttachment(i)}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Composer */}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <button type="button" className={`composer-icon ${listening ? "active" : ""}`} onClick={toggleVoice} title={listening ? "Stop" : "Voice Input"}>
              <Mic size={16} />
            </button>
            <button type="button" className="composer-icon" onClick={captureScreen} title="Screenshot">
              <Camera size={16} />
            </button>
            <button type="button" className="composer-icon" onClick={openFilePicker} title="Attach files (max 10)">
              <Paperclip size={16} />
            </button>
            <input
              className="composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={daemonRunning ? "Ask anything — code, analysis, generation…" : "Start daemon with 'elidia daemon start'"}
              disabled={!daemonRunning || sending}
            />
            <button type="submit" disabled={!daemonRunning || sending || !input.trim()}>
              <SendIcon />
            </button>
          </form>
        </div>

        {/* Right panel */}
        {showRightPanel && (
          <div className="right-panel">
            <div className="right-panel-header">
              <span className="right-panel-title">
                {activePanel === "rag" && "RAG Manager"}
                {activePanel === "dash" && "Daemon Dashboard"}
                {activePanel === "audit" && "Audit Log"}
                {activePanel === "wf" && "Workflow Builder"}
                {activePanel === "adv" && "Advanced"}
                {activePanel === "settings" && "Settings"}
                {activePanel === "info" && "Info"}
              </span>
              <button className="sidebar-btn" onClick={closePanel} title="Close panel">✕</button>
            </div>
            {activePanel === "rag" && <RagManager />}
            {activePanel === "dash" && <DaemonDashboard />}
            {activePanel === "audit" && <AuditLog />}
            {activePanel === "wf" && <WorkflowBuilder />}
            {activePanel === "adv" && <AdvancedPanel />}
            {activePanel === "settings" && <SettingsPanel />}
            {activePanel === "info" && <InfoPanel />}
          </div>
        )}
      </div>

      {/* Permission modal */}
      {permRequest && (
        <div className="perm-overlay">
          <div className="perm-modal">
            <p className="perm-text">Allow this action?</p>
            <p className="perm-id">Request: {permRequest.id}</p>
            <div className="perm-buttons">
              <button className="perm-deny" onClick={() => respondPermission(false)}>Deny</button>
              <button className="perm-allow" onClick={() => respondPermission(true)}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export default App;
