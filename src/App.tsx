import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
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

interface ChatEvent {
  event: string;
  data: unknown;
}

interface ToolCallData {
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResultData {
  name: string;
  content: string;
}

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool-call"; name: string; args: Record<string, unknown> }
  | { role: "tool-result"; name: string; content: string }
  | { role: "thinking"; model: string };

const MODES = ["chat", "code", "research", "think", "create"];

function App() {
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState("auto");
  const [availableModels, setAvailableModels] = useState<{id:string;owned_by:string}[]>([]);
  const [mode, setMode] = useState("chat");
  const [thinking, setThinking] = useState("medium");

  useEffect(() => {
    async function loadModels() {
      try {
        const resp = await invoke<{ok:boolean;models:Array<{id:string;owned_by:string}>}>("list_available_models");
        if (resp.ok && resp.models) setAvailableModels(resp.models);
      } catch { /* daemon not running yet */ }
    }
    loadModels();
  }, [daemonRunning]);
  const [dragOver, setDragOver] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [showRag, setShowRag] = useState(false);
  const [showDash, setShowDash] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showWf, setShowWf] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const [permRequest, setPermRequest] = useState<{id:string;description?:string} | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("elidia-onboarded"));
  const recognitionRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  function finishOnboarding() { localStorage.setItem("elidia-onboarded", "1"); setShowOnboarding(false); }

  function handleLoadMessages(msgs: {role:string;text:string}[]) {
    setMessages(msgs.map((m) => m.role === "user" ? { role: "user" as const, text: m.text } : { role: "assistant" as const, text: m.text }));
  }

  useEffect(() => {
    checkDaemon();
    requestNotificationPermission();
    const unlisten2 = listen<{id:string}>("permission-request", (event) => {
      setPermRequest({ id: event.payload.id });
    });
    const unlisten = listen<ChatEvent>("chat-event", (event) => {
      const { event: kind, data } = event.payload;
      switch (kind) {
        case "thinking":
          setMessages((prev) => [
            ...prev,
            { role: "thinking", model: String((data as Record<string, unknown>)?.model ?? "auto") },
          ]);
          break;
        case "tool_call": {
          const tc = data as ToolCallData;
          setMessages((prev) => [...prev, { role: "tool-call", name: tc.name, args: tc.arguments }]);
          break;
        }
        case "tool_result": {
          const tr = data as ToolResultData;
          setMessages((prev) => [
            ...prev,
            { role: "tool-result", name: tr.name, content: tr.content },
          ]);
          break;
        }
        case "content":
          setMessages((prev) => [...prev, { role: "assistant", text: String(data) }]);
          break;
        case "done":
          setSending(false);
          break;
        case "error":
          setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${data}` }]);
          setSending(false);
          break;
      }
    });
    return () => {
      unlisten.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function checkDaemon() {
    try {
      const status = await invoke<{ running: boolean }>("daemon_status");
      setDaemonRunning(status.running);
    } catch {
      setDaemonRunning(false);
    }
  }

  async function requestNotificationPermission() {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      setNotifyEnabled(granted);
    } catch { /* plugin not available in dev */ }
  }

  async function sendNotification(title: string, body: string) {
    if (!notifyEnabled) return;
    try { await invoke("notify", { title, body }); } catch { /* ok */ }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", text }]);
    try {
      await invoke("send_chat", { message: text, mode, model: model === "auto" ? null : model });
      sendNotification("Elidia", "Response ready");
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Failed: ${e}` }]);
      setSending(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() { setDragOver(false); }
  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setInput("[Voice dictation not supported in this webview]"); return; }
    const rec = new SpeechRecognition();
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => prev + (prev ? " " : "") + transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function captureScreen() {
    try {
      const path = await invoke<string>("take_screenshot");
      setInput((prev) => prev + (prev ? " " : "") + `[Screenshot: ${path}]`);
    } catch (e) { setInput(`[Screenshot failed: ${e}]`); }
  }

  async function respondPermission(approved: boolean) {
    if (!permRequest) return;
    try { await invoke("respond_permission", { id: permRequest.id, approved }); } catch {}
    setPermRequest(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    // For supported types, try RAG ingest. For images, attach as vision.
    const supported = files.filter(f => /\.(txt|md|py|js|ts|docx|xlsx|pptx|pdf|csv)$/i.test(f.name));
    const images = files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name));
    if (supported.length > 0) {
      setInput((prev) => prev + (prev ? "\n" : "") + `[Indexing: ${supported.map(f=>f.name).join(", ")} into RAG...]`);
      // RAG ingest happens via daemon — the chat handler will search for index
    }
    if (images.length > 0) {
      setInput((prev) => prev + (prev ? "\n" : "") + `[Vision image: ${images.map(f=>f.name).join(", ")}]`);
    }
    if (!supported.length && !images.length) {
      const names = files.map((f) => f.name).join(", ");
      setInput((prev) => prev + (prev ? " " : "") + `[Attached: ${names}]`);
    }
  }

  return (
    <main className="chat-app" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {showOnboarding && <Onboarding onDone={finishOnboarding} />}
      {dragOver && <div className="drop-overlay">Drop files to attach</div>}
      <div className="app-body">
        {showSidebar && <SessionSidebar onLoadMessages={handleLoadMessages} />}
        <div className="chat-column">
          <header className="chat-header">
        <div className="header-left">
          <span className="app-name">Elidia Agent Desktop</span>
          <span className={`daemon-dot ${daemonRunning ? "on" : daemonRunning === false ? "off" : "unknown"}`} />
          <span className="daemon-label">
            {daemonRunning === null ? "checking..." : daemonRunning ? "daemon running" : "daemon stopped"}
          </span>
        </div>
        <div className="header-right">
          <span className="mode-label">model:</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="mode-select">
            <option value="auto">auto (system picks best)</option>
            {availableModels.length > 0 ? availableModels.map(m => (
              <option key={m.id} value={m.id}>{m.id} @ {m.owned_by}</option>
            )) : <>
              <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="qwen3:1.7b">qwen3:1.7b (local)</option>
            </>}
          </select>
          <span className="mode-label">think:</span>
          <select value={thinking} onChange={(e) => setThinking(e.target.value)} className="mode-select">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="deep">deep</option>
          </select>
          <span className="mode-label">mode:</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="mode-select">
            {MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button className="refresh-btn" onClick={() => setShowRag(!showRag)} title="RAG Manager">
            {showRag ? "✕" : "📚"}
          </button>
          <button className="refresh-btn" onClick={() => setShowDash(!showDash)} title="Daemon Dashboard">
            {showDash ? "✕" : "⚙"}
          </button>
          <button className="refresh-btn" onClick={() => setShowAudit(!showAudit)} title="Audit Log">
            {showAudit ? "✕" : "🔍"}
          </button>
          <button className="refresh-btn" onClick={() => setShowWf(!showWf)} title="Workflow Builder">
            {showWf ? "✕" : "⚡"}
          </button>
          <button className="refresh-btn" onClick={() => setShowInfo(!showInfo)} title="Agent Info">
            {showInfo ? "✕" : "ℹ"}
          </button>
          <button className="refresh-btn" onClick={() => setShowAdvanced(!showAdvanced)} title="Research & Creative">
            {showAdvanced ? "✕" : "🔬"}
          </button>
          <button className="refresh-btn" onClick={() => setShowSidebar(!showSidebar)} title="Toggle sidebar">
            {showSidebar ? "☰" : "☰"}
          </button>
          <button className="refresh-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">
            {showSettings ? "✕" : "⚙"}
          </button>
          <button className="refresh-btn" onClick={checkDaemon} title="Check daemon status">⟳</button>
        </div>
      </header>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Elidia Agent Desktop — Phase 1</p>
            <p className="sub">Send a message to start. The daemon must be running
            (<code>elidia daemon start</code> in a terminal first).</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === "user" && <div className="bubble user-bubble">{msg.text}</div>}
            {msg.role === "assistant" && <div className="bubble assistant-bubble">{msg.text}</div>}
            {msg.role === "tool-call" && (
              <div className="tool-card">
                <span className="tool-icon">🔧</span>
                <span className="tool-name">{msg.name}({JSON.stringify(msg.args)})</span>
              </div>
            )}
            {msg.role === "tool-result" && (
              <div className="tool-card result">
                <span className="tool-icon">📋</span>
                <span className="tool-content">{msg.content.slice(0, 200)}</span>
              </div>
            )}
            {msg.role === "thinking" && (
              <div className="thinking-line">
                <span className="thinking-icon">🧠</span> thinking with {msg.model}…
              </div>
            )}
          </div>
        ))}
        {sending && <div className="message assistant"><div className="bubble assistant-bubble typing">…</div></div>}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          className="composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={daemonRunning ? "Send a message…" : "Daemon not running — start with 'elidia daemon start' first"}
          disabled={!daemonRunning || sending}
        />
        <button type="button" className={`composer-icon ${listening ? "active" : ""}`}
          onClick={toggleVoice} title={listening ? "Stop listening" : "Voice input"}>
          {listening ? "⏹" : "🎤"}
        </button>
        <button type="button" className="composer-icon" onClick={captureScreen} title="Capture screen">
          📸
        </button>
        <button type="submit" disabled={!daemonRunning || sending || !input.trim()}>
          Send
        </button>
      </form>
        </div>
        {showRag && <RagManager />}
        {showDash && <DaemonDashboard />}
        {showAudit && <AuditLog />}
        {showWf && <WorkflowBuilder />}
        {showInfo && <InfoPanel />}
        {showAdvanced && <AdvancedPanel />}
        {showSettings && <SettingsPanel />}
      </div>
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

export default App;
