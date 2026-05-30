/* ============================================================
   NicoSoft AI Studio — Onboarding (3-step first-run flow)
   ============================================================ */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar } from '@/components/primitives'
import { ProfileForm } from '@/views/profile'
import { STUDIO_DATA } from '@/data/studio-data'

function Dots({ step, count = 3 }: { step: number; count?: number }): ReactElement {
  return (
    <div className="dots">
      {Array.from({ length: count }).map((_, i) => <span key={i} className={"dot" + (i === step ? " active" : "")} />)}
    </div>
  );
}

function OnboardWelcome(): ReactElement {
  return (
    <>
      <div className="onboard-logo">N</div>
      <div className="onboard-h1">Welcome to NicoSoft AI Studio</div>
      <div className="onboard-sub">A desktop workspace where a small team of named AI experts works for you. Let's get you set up — starting with your name.</div>
      <div className="welcome-points">
        <div className="wp-item"><span className="wp-dot" style={{ background: "var(--exp-hex)" }} /> Eight named experts, each on the model best suited to its job</div>
        <div className="wp-item"><span className="wp-dot" style={{ background: "var(--accent)" }} /> Atlas routes your request — or convenes several experts to collaborate</div>
        <div className="wp-item"><span className="wp-dot" style={{ background: "var(--exp-lyra)" }} /> Bring your own keys; everything stays on your device</div>
      </div>
    </>
  );
}

function OnboardEndpoint(): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const [tested, setTested] = useState(false);
  return (
    <>
      <div className="onboard-h1" style={{ fontSize: 22 }}>Add your first AI endpoint</div>
      <div className="onboard-sub">Connect a provider so your experts have a model to run on. You can add more later.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <div>
          <label className="field-label">Provider</label>
          <div className="select-box" style={{ width: "100%" }}>
            Anthropic <Icons.chevronDown size={14} className="chev" />
          </div>
        </div>
        <div>
          <label className="field-label">API key</label>
          <div className="key-input-wrap">
            <input className="input mono" type={showKey ? "text" : "password"} defaultValue="sk-ant-api03-7f2a91c0" />
            <button className="key-toggle" onClick={() => setShowKey((s) => !s)}>
              {showKey ? <Icons.eyeOff size={15} /> : <Icons.eye size={15} />}
            </button>
          </div>
          <div className="link-row">
            <span className="text-link">Get a key <Icons.external size={12} /></span>
            {tested && <span className="test-success"><Icons.check size={14} /> Connected · 6 models found</span>}
          </div>
        </div>
        <div>
          <button className="btn secondary" onClick={() => setTested(true)} style={{ width: "100%" }}>
            <Icons.plug size={15} /> Test connection
          </button>
        </div>
      </div>
    </>
  );
}

function OnboardTeam(): ReactElement {
  const { EXPERTS } = STUDIO_DATA;
  const familyLabel: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" };
  return (
    <>
      <div className="onboard-h1" style={{ fontSize: 22 }}>Meet your team</div>
      <div className="onboard-sub">Eight experts, each on the model best suited to its job. Atlas coordinates them.</div>
      <div className="team-grid">
        {EXPERTS.map((e) => (
          <div className="team-card" key={e.id}>
            <Avatar expert={e} size={32} />
            <div className="tc-meta">
              <div className="tc-name">{e.name}</div>
              <div className="tc-spec">{e.specialty.split("—")[1] ? e.specialty.split("—")[1].trim() : e.specialty}</div>
              <div className="tc-model">{familyLabel[e.family ?? '']} · {e.model}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function OnboardProfile(): ReactElement {
  return (
    <>
      <div className="onboard-h1" style={{ fontSize: 22 }}>First, what should we call you?</div>
      <div className="onboard-sub">Your name is the one thing the team really needs — the rest is optional and you can add it anytime under Settings.</div>
      <ProfileForm compact nudgeName />
    </>
  );
}

export function Onboarding({ onFinish }: { onFinish: () => void }): ReactElement {
  const [step, setStep] = useState(0);
  const last = 3;
  const next = () => (step < last ? setStep(step + 1) : onFinish());
  const back = () => step > 0 && setStep(step - 1);

  return (
    <div className="onboard">
      <div className={"onboard-card" + (step === 1 || step === 3 ? " wide" : "")}>
        {step === 0 && <OnboardWelcome />}
        {step === 1 && <OnboardProfile />}
        {step === 2 && <OnboardEndpoint />}
        {step === 3 && <OnboardTeam />}
        <div className="onboard-foot">
          {step > 0
            ? <button className="btn ghost sm" onClick={back}><Icons.chevronLeft size={14} /> Back</button>
            : <span />}
          {(step === 1 || step === 2) && <span className="text-link muted" style={{ marginLeft: 14 }} onClick={next}>Skip — I'll do this later</span>}
          <div className="of-spacer" />
          <Dots step={step} count={4} />
          <div className="of-spacer" />
          <button className="btn primary sm" onClick={next}>
            {step === last ? "Start" : "Continue"} {step < last && <Icons.arrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
