import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./WorkflowBuilder.css";

type StepType = "llm" | "tool" | "shell" | "parallel" | "loop";

interface WorkflowStep {
  name: string;
  type: StepType;
  prompt?: string;
  command?: string;
  tool?: string;
  model?: string;
}

interface WorkflowResult {
  ok: boolean;
  error?: string;
  workflow_name?: string;
  completed?: number;
  failed?: number;
  steps?: Array<{ name: string; status: string; elapsed_ms: number; output_preview?: string }>;
}

export default function WorkflowBuilder() {
  const [name, setName] = useState("my-workflow");
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showYaml, setShowYaml] = useState(false);

  function addStep(type: StepType) {
    setSteps([...steps, { name: `step_${steps.length + 1}`, type }]);
  }
  function removeStep(i: number) { setSteps(steps.filter((_, j) => j !== i)); }
  function updateStep(i: number, update: Partial<WorkflowStep>) {
    setSteps(steps.map((s, j) => j === i ? { ...s, ...update } : s));
  }

  function toYaml(): string {
    const lines = [`name: ${name}`];
    if (steps.length) {
      lines.push("steps:");
      for (const s of steps) {
        lines.push(`  - name: ${s.name}`);
        lines.push(`    type: ${s.type}`);
        if (s.type === "llm") {
          if (s.prompt) lines.push(`    prompt: "${s.prompt.replace(/"/g, '\\"')}"`);
          if (s.model) lines.push(`    model: ${s.model}`);
        } else if (s.type === "tool") {
          if (s.tool) lines.push(`    tool: ${s.tool}`);
        } else if (s.type === "shell") {
          if (s.command) lines.push(`    command: ${s.command}`);
        }
      }
    }
    return lines.join("\n");
  }

  async function runWorkflow() {
    setRunning(true);
    setResult(null);
    try {
      const yaml = toYaml();
      const r = await invoke<WorkflowResult>("workflow_run", { yaml });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="wf-panel">
      <h3 className="wf-title">Workflow Builder</h3>

      <div className="wf-row">
        <label className="wf-label">Name:</label>
        <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="wf-toolbar">
        <button className="wf-btn" onClick={() => addStep("llm")}>+ LLM</button>
        <button className="wf-btn" onClick={() => addStep("tool")}>+ Tool</button>
        <button className="wf-btn" onClick={() => addStep("shell")}>+ Shell</button>
        <button className="wf-btn" onClick={() => addStep("parallel")}>+ Parallel</button>
      </div>

      {steps.map((s, i) => (
        <div key={i} className="wf-step">
          <div className="wf-step-header">
            <span className="wf-step-type">{s.type}</span>
            <input className="wf-step-name" value={s.name} onChange={(e) => updateStep(i, { name: e.target.value })} />
            <button className="wf-remove" onClick={() => removeStep(i)}>✕</button>
          </div>
          <div className="wf-step-body">
            {s.type === "llm" && (
              <>
                <textarea className="wf-textarea" placeholder="Prompt…" value={s.prompt || ""} onChange={(e) => updateStep(i, { prompt: e.target.value })} />
                <input className="wf-input-sm" placeholder="Model (default: auto)" value={s.model || ""} onChange={(e) => updateStep(i, { model: e.target.value })} />
              </>
            )}
            {s.type === "tool" && (
              <input className="wf-input-sm" placeholder="Tool name (e.g. file_read)" value={s.tool || ""} onChange={(e) => updateStep(i, { tool: e.target.value })} />
            )}
            {s.type === "shell" && (
              <input className="wf-input-sm" placeholder="Shell command" value={s.command || ""} onChange={(e) => updateStep(i, { command: e.target.value })} />
            )}
            {s.type === "parallel" && <p className="wf-note">Parallel groups bundle their child steps — add child steps inside the group.</p>}
          </div>
        </div>
      ))}

      <div className="wf-actions">
        <button className="wf-btn primary" onClick={runWorkflow} disabled={running}>
          {running ? "Running…" : "▶ Run"}
        </button>
        <button className="wf-btn" onClick={() => setShowYaml(!showYaml)}>
          {showYaml ? "Hide YAML" : "Show YAML"}
        </button>
      </div>

      {showYaml && <pre className="wf-yaml">{toYaml()}</pre>}

      {result && (
        <div className={`wf-result ${result.ok ? "ok" : "err"}`}>
          {result.ok
            ? `${result.workflow_name}: ${result.completed} completed, ${result.failed} failed`
            : `Error: ${result.error}`}
          {result.steps?.map((s, i) => (
            <div key={i} className="wf-result-step">
              <span className={s.status === "completed" ? "ok" : "err"}>{s.status}</span> {s.name} ({s.elapsed_ms}ms)
              {s.output_preview && <span className="wf-output"> — {s.output_preview.slice(0, 80)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
