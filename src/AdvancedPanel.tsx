import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ResearchEvent { event: string; data: unknown; }

export default function AdvancedPanel() {
  const [tab, setTab] = useState<"research" | "creative" | "moa">("research");
  const [question, setQuestion] = useState("");
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unlisten = listen<ResearchEvent>("research-event", (ev) => {
      setEvents((prev) => [...prev, ev.payload]);
      if (ev.payload.event === "done") setRunning(false);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  async function start() {
    if (!question.trim() || running) return;
    setEvents([]);
    setRunning(true);
    try {
      await invoke("start_research", { question: question.trim() });
    } catch (e) {
      setEvents((prev) => [...prev, { event: "error", data: String(e) }]);
      setRunning(false);
    }
  }

  const creativeTools = [
    { name: "Image generation", desc: "Generate images from text prompts", models: "DALL-E, Flux, SDXL" },
    { name: "Video generation", desc: "Generate short video clips", models: "Runway, Pika" },
    { name: "Audio generation", desc: "Text-to-speech + music generation", models: "ElevenLabs, MusicGen" },
    { name: "Face swap (local)", desc: "Offline face swap via InsightFace", models: "Local GPU" },
    { name: "Background removal (local)", desc: "Offline bg removal via rembg", models: "Local GPU" },
  ];

  return (
    <div className="info-panel">
      <div className="info-tabs">
        <button className={`info-tab ${tab === "research" ? "active" : ""}`} onClick={() => setTab("research")}>🔬 Research</button>
        <button className={`info-tab ${tab === "creative" ? "active" : ""}`} onClick={() => setTab("creative")}>🎨 Creative</button>
        <button className={`info-tab ${tab === "moa" ? "active" : ""}`} onClick={() => setTab("moa")}>🧠 MoA</button>
      </div>

      <div className="info-body">
        {tab === "research" && (
          <div>
            <div className="info-search-row">
              <input className="info-input" placeholder="Research question…" value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && start()} />
              <button className="info-btn" onClick={start} disabled={running}>
                {running ? "…" : "Go"}
              </button>
            </div>
            {events.map((e, i) => (
              <div key={i} className={`research-event ${e.event}`}>
                <span className="re-kind">{e.event}</span>
                <span className="re-data">
                  {typeof e.data === "string" ? e.data.slice(0, 200) : JSON.stringify(e.data).slice(0, 200)}
                </span>
              </div>
            ))}
            {events.length === 0 && <p className="info-empty">Enter a research question to start the YOYO 5-agent pipeline.</p>}
          </div>
        )}

        {tab === "moa" && (
          <div>
            <p className="info-sub" style={{marginBottom:12}}>Mixture of Agents — 2-3 models run in parallel with independent tool access, then synthesize the best answer.</p>
            <p className="info-empty">Use /moa &lt;query&gt; in chat to run MoA. Default: claude-sonnet-4-6 + deepseek-v4-pro + gpt-4o in parallel.</p>
            <div className="settings-item"><span className="settings-key">Premium Mix</span><span className="settings-val">Claude Sonnet + DeepSeek Pro + GPT-4o</span></div>
            <div className="settings-item"><span className="settings-key">Budget Mix</span><span className="settings-val">DeepSeek Pro + Flash + GPT-4.1 Mini</span></div>
          </div>
        )}
        {tab === "creative" && (
          <div>
            <p className="info-sub" style={{marginBottom:12}}>Creative tools available via the chat agent — the agent routes to these automatically based on your prompt.</p>
            {creativeTools.map((t, i) => (
              <div key={i} className="info-item">
                <span className="info-key">{t.name}</span>
                <div className="info-content">{t.desc}</div>
                <span className="info-model">{t.models}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
