import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Brain, Search, TrendingUp, AlertTriangle, Lightbulb } from "lucide-react";

interface ModelPerf { model: string; task_type: string; success_rate: number; total?: number; successes?: number; failures?: number; }
interface Preference { type: string; key: string; value: string; confidence: number; }
interface FailurePattern { pattern: string; count: number; fix: string; }
interface Entity { name: string; type: string; description: string; confidence: number; count: number; relations: Array<{source:string;target:string;type:string}>; }
interface Insights { total_outcomes: number; overall_success_rate: number; total_successes: number; total_failures: number; }

export default function LearningPanel() {
  const [tab, setTab] = useState<"performance" | "knowledge" | "patterns">("performance");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [perf, setPerf] = useState<ModelPerf[]>([]);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [failures, setFailures] = useState<FailurePattern[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [kgQuery, setKgQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [outResp, learnResp] = await Promise.all([
        invoke<{ok:boolean;insights:Insights;model_performance:ModelPerf[]}>("get_outcomes"),
        invoke<{ok:boolean;insights:Insights;model_performance:ModelPerf[];preferences:Preference[];failure_patterns:FailurePattern[]}>("get_learning_report"),
      ]);
      if (outResp.ok) {
        setInsights(outResp.insights);
        setPerf(outResp.model_performance || []);
      }
      if (learnResp.ok) {
        setPrefs(learnResp.preferences || []);
        setFailures(learnResp.failure_patterns || []);
      }
    } catch {}
    setLoading(false);
  }

  async function searchKG() {
    if (!kgQuery.trim()) return;
    try {
      const resp = await invoke<{ok:boolean;entities:Entity[]}>("search_knowledge", { query: kgQuery });
      if (resp.ok) setEntities(resp.entities || []);
    } catch {}
  }

  if (loading) return <div className="settings-panel"><p style={{color:"var(--text-muted)",fontStyle:"italic"}}>Loading learning data…</p></div>;

  return (
    <div className="settings-panel">
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
        <Brain size={18} style={{color:"var(--accent)"}} />
        <span style={{fontWeight:700,fontSize:13}}>Learning Dashboard</span>
      </div>

      {/* Summary stats */}
      {insights && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:14}}>
          <div className="stat-mini" style={{background:"var(--accent-soft)",borderRadius:"var(--radius-sm)",padding:"8px 10px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"var(--accent)"}}>{insights.overall_success_rate ? `${(insights.overall_success_rate*100).toFixed(0)}%` : "—"}</div>
            <div style={{fontSize:9,color:"var(--text-muted)"}}>Success Rate</div>
          </div>
          <div className="stat-mini" style={{background:"var(--accent-soft)",borderRadius:"var(--radius-sm)",padding:"8px 10px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"var(--accent)"}}>{insights.total_outcomes || 0}</div>
            <div style={{fontSize:9,color:"var(--text-muted)"}}>Outcomes</div>
          </div>
          <div className="stat-mini" style={{background: "rgba(34,197,94,0.1)",borderRadius:"var(--radius-sm)",padding:"8px 10px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"var(--green)"}}>{insights.total_successes||0}</div>
            <div style={{fontSize:9,color:"var(--text-muted)"}}>Successes</div>
          </div>
          <div className="stat-mini" style={{background: "rgba(239,68,68,0.08)",borderRadius:"var(--radius-sm)",padding:"8px 10px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"var(--red)"}}>{insights.total_failures||0}</div>
            <div style={{fontSize:9,color:"var(--text-muted)"}}>Failures</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="settings-tabs" style={{marginBottom:10}}>
        {(["performance","knowledge","patterns"] as const).map(t => (
          <button key={t} className={`settings-tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>
            {t==="performance"&&<><TrendingUp size={11}/> Models</>}
            {t==="knowledge"&&<><Search size={11}/> Knowledge</>}
            {t==="patterns"&&<><AlertTriangle size={11}/> Patterns</>}
          </button>
        ))}
      </div>

      {/* Performance tab */}
      {tab === "performance" && (
        <div>
          {perf.length === 0 && <p className="settings-empty">No outcome data yet. Use Elidia to build learning history.</p>}
          {perf.map((p,i) => (
            <div key={i} className="settings-item">
              <div>
                <div className="settings-key">{p.model}</div>
                <div style={{fontSize:10,color:"var(--text-muted)"}}>{p.task_type}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:700,color:p.success_rate>=0.8?"var(--green)":p.success_rate>=0.5?"var(--orange)":"var(--red)",fontSize:14}}>
                  {(p.success_rate*100).toFixed(0)}%
                </div>
                {p.total && <div style={{fontSize:9,color:"var(--text-muted)"}}>{p.total} runs</div>}
              </div>
            </div>
          ))}
          {prefs.length > 0 && (
            <>
              <div style={{fontSize:10,fontWeight:700,color:"var(--text-muted)",textTransform:"uppercase",margin:"12px 0 6px"}}>Learned Preferences</div>
              {prefs.map((p,i) => (
                <div key={i} className="settings-item">
                  <div className="settings-key">{p.key}</div>
                  <div className="settings-val">{p.value} ({Math.round(p.confidence*100)}%)</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Knowledge tab */}
      {tab === "knowledge" && (
        <div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <input className="onboard-input" style={{margin:0,flex:1}} placeholder="Search entities…"
              value={kgQuery} onChange={e=>setKgQuery(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&searchKG()} />
            <button className="settings-tab active" style={{padding:"6px 12px",cursor:"pointer"}} onClick={searchKG}>Search</button>
          </div>
          {entities.length === 0 && <p className="settings-empty">Search for people, projects, technologies, or concepts.</p>}
          {entities.map((e,i) => (
            <div key={i} className="settings-item" style={{flexDirection:"column",alignItems:"flex-start",gap:4}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10,background:"var(--accent-soft)",color:"var(--accent)",padding:"1px 6px",borderRadius:4}}>{e.type}</span>
                <span className="settings-key">{e.name}</span>
                <span style={{fontSize:9,color:"var(--text-muted)"}}>×{e.count}</span>
              </div>
              {e.description && <div style={{fontSize:11,color:"var(--text-secondary)"}}>{e.description.slice(0,120)}</div>}
              {e.relations.length > 0 && (
                <div style={{fontSize:10,color:"var(--text-muted)",display:"flex",gap:4,flexWrap:"wrap"}}>
                  {e.relations.slice(0,4).map((r,j)=>(
                    <span key={j} style={{background:"var(--surface)",padding:"1px 6px",borderRadius:4}}>
                      {r.type} → {r.target}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Patterns tab */}
      {tab === "patterns" && (
        <div>
          {failures.length === 0 && <p className="settings-empty">No failure patterns detected. More outcomes needed for pattern analysis.</p>}
          {failures.map((f,i) => (
            <div key={i} className="settings-item" style={{flexDirection:"column",alignItems:"flex-start",gap:4}}>
              <div style={{fontWeight:600,fontSize:12,color:"var(--red)"}}>
                <AlertTriangle size={10} style={{marginRight:4}} />
                {f.pattern}
              </div>
              <div style={{fontSize:10,color:"var(--text-muted)"}}>Occurred {f.count}×</div>
              {f.fix && <div style={{fontSize:10,color:"var(--green)",display:"flex",alignItems:"center",gap:4}}>
                <Lightbulb size={10} />{f.fix}
              </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
