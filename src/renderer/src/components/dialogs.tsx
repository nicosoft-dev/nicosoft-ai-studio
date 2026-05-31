/* ============================================================
   NicoSoft AI Studio — dialogs: endpoint, role editor, ⌘K
   ============================================================ */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import { useRoles } from '@/stores/roles'
import type { EndpointRow, Expert, Family } from '@/types'

/* — Add / Edit endpoint dialog (controlled) — */
const PROTO_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  custom: "https://",
}

export function EndpointDialog({
  initial,
  onClose,
  onSave
}: {
  initial?: EndpointRow | null
  onClose: () => void
  onSave: (row: EndpointRow, initial: EndpointRow | null) => void
}): ReactElement {
  const [name, setName] = useState(initial ? initial.name : "")
  const [proto, setProto] = useState<Family | 'custom'>(initial ? initial.proto : "openai")
  const [baseURL, setBaseURL] = useState(initial ? (initial.baseURL || PROTO_BASE[initial.proto ?? 'openai']) : PROTO_BASE.openai)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [tested, setTested] = useState(false)
  const [models, setModels] = useState<string[]>(initial?.models ?? [])
  const [modelDraft, setModelDraft] = useState("")
  const editing = !!initial

  const addModel = (raw: string): void => {
    const v = raw.trim()
    if (v && !models.includes(v)) setModels([...models, v]) // duplicates ignored
    setModelDraft("")
  }

  const save = (): void => {
    const masked = apiKey ? "••••••" + apiKey.slice(-4) : (initial ? initial.key : "••••••0000")
    onSave({
      name: name || "Untitled", proto: proto as Family,
      status: editing ? initial!.status : "healthy",
      models,
      key: masked, baseURL,
    }, initial ?? null)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span className="dh-title">{editing ? "Edit endpoint" : "Add endpoint"}</span>
          <button className="icon-btn" onClick={onClose}><Icons.x size={16} /></button>
        </div>
        <div className="dialog-body">
          <div>
            <label className="field-label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My endpoint" />
          </div>
          <div>
            <label className="field-label">Protocol</label>
            <div className="segmented">
              {["openai", "anthropic", "gemini", "custom"].map((p) => (
                <button key={p} className={proto === p ? "active" : ""}
                  onClick={() => { setProto(p as Family | 'custom'); setBaseURL(PROTO_BASE[p]); }}>
                  {p === "openai" ? "OpenAI" : p === "anthropic" ? "Anthropic" : p === "gemini" ? "Gemini" : "Custom"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">Base URL</label>
            <input className="input mono" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          </div>
          <div>
            <label className="field-label">API key</label>
            <div className="key-input-wrap">
              <input className="input mono" type={showKey ? "text" : "password"} value={apiKey}
                onChange={(e) => setApiKey(e.target.value)} placeholder={editing ? "•••••• (unchanged)" : "sk-…"} />
              <button className="key-toggle" onClick={() => setShowKey((s) => !s)}>
                {showKey ? <Icons.eyeOff size={15} /> : <Icons.eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="field-label">
              Models <span style={{ color: "var(--text-4)", fontWeight: 400 }}>· {models.length}</span>
            </label>
            <div className="model-tags" onClick={(e) => (e.currentTarget.querySelector(".mt-input") as HTMLInputElement | null)?.focus()}>
              {models.map((m) => (
                <span className="model-tag" key={m}>
                  {m}
                  <button className="mt-remove" title="Remove" onClick={() => setModels(models.filter((x) => x !== m))}>
                    <Icons.x size={11} />
                  </button>
                </span>
              ))}
              <input
                className="mt-input"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addModel(modelDraft); }
                  else if (e.key === "Backspace" && !modelDraft && models.length > 0) setModels(models.slice(0, -1));
                }}
                placeholder={models.length > 0 ? "Add another…" : "provider/model-id, press Enter"}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
          {tested && (
            <div className="test-success">
              <Icons.check size={15} /> Connection OK
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn secondary sm" onClick={() => setTested(true)}>Test connection</button>
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

/* — Custom role editor — */
const ROLE_SWATCHES = [
  "var(--exp-iris)", "var(--exp-hex)", "var(--exp-lyra)", "var(--exp-echo)",
  "var(--exp-sage)", "var(--exp-quant)", "var(--exp-mercury)", "var(--accent)",
  "var(--text-3)",
]
const ROLE_TOOLS = ["Web search", "Code execution", "Image generation", "File reading"]

export function RoleEditorDialog({ onClose }: { onClose: () => void }): ReactElement {
  const [name, setName] = useState("Pixel")
  const [color, setColor] = useState("var(--exp-lyra)")
  const [tools, setTools] = useState<Record<string, boolean>>({ "Image generation": true })
  const previewExpert = { name: name || "?", color } as Expert
  const toggleTool = (t: string): void => setTools((prev) => ({ ...prev, [t]: !prev[t] }))

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span className="dh-title">New role</span>
          <button className="icon-btn" onClick={onClose}><Icons.x size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="preview-box">
            <Avatar expert={previewExpert} size={36} />
            <div>
              <span className="name-chip" style={{ "--chip-color": color } as CSSProperties}>{name || "Unnamed"}</span>
              <div style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 4 }}>Live preview · avatar &amp; name chip</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pixel" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Color</label>
              <div className="swatch-row" style={{ paddingTop: 4 }}>
                {ROLE_SWATCHES.map((c) => (
                  <span key={c} className={"swatch" + (color === c ? " selected" : "")}
                    style={{ background: c, "--sw-color": c } as CSSProperties} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="field-label">System prompt</label>
            <textarea className="input" style={{ height: 70, paddingTop: 8, resize: "none" }}
              defaultValue="You are Pixel, a focused image specialist. Be opinionated about composition and color. Always confirm the required text and aspect ratio before generating." />
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="field-label">Endpoint</label>
              <div className="select-box">Google Gemini <Icons.chevronDown size={14} className="chev" /></div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">Model</label>
              <div className="select-box"><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>imagen-4</span> <Icons.chevronDown size={14} className="chev" /></div>
            </div>
          </div>
          <div>
            <label className="field-label">Tools</label>
            <div className="tools-list">
              {ROLE_TOOLS.map((t) => (
                <div className="tool-check" key={t} onClick={() => toggleTool(t)}>
                  <span className={"checkbox" + (tools[t] ? " on" : "")}>{tools[t] && <Icons.check size={12} />}</span>
                  <span className="tc-label">{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">Greeting <span style={{ color: "var(--text-4)", fontWeight: 400 }}>· optional</span></label>
            <input className="input" defaultValue="Hi, I'm Pixel — tell me the vibe, the text, and the format."
              placeholder="First line the expert shows on a new conversation" />
          </div>
        </div>
        <div className="dialog-foot">
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={onClose}>Create role</button>
        </div>
      </div>
    </div>
  )
}

/* — Command palette (⌘K) — */
type CmdkRow = {
  group?: string
  type?: 'conv' | 'expert' | 'settings' | 'action'
  id?: string
  label?: string
  expert?: string
  hint?: string
  avatar?: Expert
  icon?: string
}

export function CommandPalette({
  onClose,
  onSelectConv,
  onSelectExpert,
  onSettings,
  onStudio,
  onNewRole
}: {
  onClose: () => void
  onSelectConv: (id: string) => void
  onSelectExpert: (id: string) => void
  onSettings: (tab: string) => void
  onStudio: () => void
  onNewRole: () => void
}): ReactElement {
  const { HISTORY, EXPERTS, EXPERT_BY_ID } = STUDIO_DATA
  const roles = useRoles()
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, [])

  const recents = HISTORY.flatMap((g) => g.items).slice(0, 4)
  const activeExperts = EXPERTS.filter((e) => !roles.isDeleted(e.id) && !roles.isDisabled(e.id))
  const rows: CmdkRow[] = []
  rows.push({ group: "Recent conversations" })
  recents.forEach((c) => rows.push({ type: "conv", id: c.id, label: c.title, expert: c.expert }))
  rows.push({ group: "Roles" })
  activeExperts.forEach((e) => rows.push({ type: "expert", id: e.id, label: e.name, hint: e.specialty, avatar: e }))
  rows.push({ group: "Settings" })
  ;([["endpoints", "Endpoints", "plug"], ["roles", "Roles", "users"], ["memory", "Memory", "box"], ["profile", "Profile", "user"]] as const)
    .forEach(([tab, label, icon]) => rows.push({ type: "settings", id: tab, label, icon }))
  rows.push({ group: "Actions" })
  rows.push({ type: "action", id: "studio", label: "Go to Studio", icon: "layoutGrid" })
  rows.push({ type: "action", id: "new", label: "New conversation", icon: "plusCircle" })
  rows.push({ type: "action", id: "export", label: "Export conversation", icon: "download" })
  rows.push({ type: "action", id: "newrole", label: "New role", icon: "plus" })

  const selectable = rows.filter((r) => !r.group)
  const filtered = q
    ? selectable.filter((r) => r.label!.toLowerCase().includes(q.toLowerCase()))
    : null
  const navList = filtered || selectable

  const pick = (r?: CmdkRow): void => {
    if (!r) return
    if (r.type === "conv") onSelectConv(r.id!)
    else if (r.type === "expert") onSelectExpert(r.id!)
    else if (r.type === "settings") onSettings(r.id!)
    else if (r.id === "studio") onStudio()
    else if (r.id === "newrole") onNewRole()
    else onClose()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, navList.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(navList[active]); }
  }

  let runningIndex = -1
  const renderRow = (r: CmdkRow, key: number): ReactElement => {
    if (r.group) return <div className="cmdk-group-label" key={key}>{r.group}</div>
    runningIndex++
    const idx = runningIndex
    const I = r.icon ? Icons[r.icon] : null
    const convExpert = r.type === "conv" ? EXPERT_BY_ID[r.expert!] : null
    return (
      <div key={key} className={"cmdk-row" + (idx === active ? " active" : "")}
        onMouseEnter={() => setActive(idx)} onMouseDown={() => pick(r)}>
        <span className="cr-icon">
          {r.avatar ? <Avatar expert={r.avatar} size={20} />
            : convExpert ? <span className="cr-dot" style={{ background: convExpert.color }} />
            : I ? <I size={16} /> : null}
        </span>
        <span className="cr-label">{r.label}</span>
        {r.hint && <span className="cr-hint">{r.hint}</span>}
      </div>
    )
  }

  return (
    <div className="overlay top" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-search">
          <Icons.search size={17} style={{ color: "var(--text-3)" }} />
          <input ref={inputRef} placeholder="Search conversations, roles, actions…"
            value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
          <kbd style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-4)", background: "var(--bg-3)", borderRadius: 4, padding: "2px 6px" }}>ESC</kbd>
        </div>
        <div className="cmdk-results">
          {filtered
            ? (filtered.length ? filtered.map((r, i) => renderRow(r, i)) : <div className="cmdk-group-label">No results</div>)
            : rows.map((r, i) => renderRow(r, i))}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

/* — Reusable confirm dialog (e.g. delete a custom role) — */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span className="dh-title">{title}</span>
          <button className="icon-btn" onClick={onClose}><Icons.x size={16} /></button>
        </div>
        <div className="dialog-body"><p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>{body}</p></div>
        <div className="dialog-foot">
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className={"btn sm " + (danger ? "danger" : "primary")} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
