import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState({ address: "", password: "", smtp: "", smtpPort: 587, imap: "", imapPort: 993 });

  async function saveKey() {
    if (!apiKey.startsWith("ak-dev-")) { setStatus("Key must start with ak-dev-"); return; }
    try {
      await invoke("store_api_key", { key: apiKey });
      setStatus("API key stored ✓"); setStep(2);
    } catch (e) { setStatus(`Error: ${e}`); }
  }

  async function saveEmail() {
    if (!email.address || !email.password) return;
    try {
      await invoke("store_email_creds", {
        address: email.address, password: email.password,
        smtpHost: email.smtp || `smtp.${email.address.split("@")[1]}`,
        smtpPort: email.smtpPort, imapHost: email.imap || `imap.${email.address.split("@")[1]}`,
        imapPort: email.imapPort, fromAddress: email.address,
      });
    } catch {}
    onDone();
  }

  return (
    <div className="onboard-overlay">
      <div className="onboard-modal">
        <h2>Welcome to Elidia Agent Desktop</h2>
        {step === 1 && (
          <div>
            <p>Enter your AiUtils API key to get started.</p>
            <p className="onboard-hint">Get one at developer.aiutils.io — keys start with ak-dev-</p>
            <input className="onboard-input" type="password" placeholder="ak-dev-..." value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()} />
            <p className="onboard-status">{status}</p>
            <div className="onboard-buttons">
              <button className="onboard-btn primary" onClick={saveKey}>Continue</button>
              <button className="onboard-btn" onClick={() => setStep(2)}>Skip</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <p>Optional: set up email for notifications and email skills.</p>
            <input className="onboard-input" placeholder="Email address" value={email.address}
              onChange={(e) => setEmail({...email, address: e.target.value})} />
            <input className="onboard-input" type="password" placeholder="App password (not your account password)"
              value={email.password} onChange={(e) => setEmail({...email, password: e.target.value})} />
            <div className="onboard-buttons">
              <button className="onboard-btn primary" onClick={saveEmail}>Finish</button>
              <button className="onboard-btn" onClick={onDone}>Skip</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
