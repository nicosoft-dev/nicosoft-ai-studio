/* ============================================================
   NicoSoft AI Studio — Settings
   Profile · Memory · Endpoints · Roles · General · Privacy · About
   ============================================================ */
import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar, HealthDot } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import { useRoles } from '@/stores/roles'
import { EndpointDialog } from '@/components/dialogs'
import { ProfilePage, Dropdown } from '@/views/profile'
import { MemorySettings } from '@/views/memory'
import type { Expert, EndpointRow, Family, RoleBinding } from '@/types'

const SETTINGS_NAV: { id: string; label: string; icon: string }[] = [
  { id: "profile",   label: "Profile",   icon: "user" },
  { id: "memory",    label: "Memory",    icon: "box" },
  { id: "endpoints", label: "Endpoints", icon: "plug" },
  { id: "roles",     label: "Roles",     icon: "users" },
  { id: "general",   label: "General",   icon: "sliders" },
  { id: "privacy",   label: "Privacy",   icon: "shield" },
  { id: "about",     label: "About",     icon: "info" },
];

function SettingsNav({
  active,
  onSelect,
  onBack
}: {
  active: string
  onSelect: (id: string) => void
  onBack: () => void
}): ReactElement {
  return (
    <div className="settings-nav">
      <div className="sn-back" onClick={onBack}>
        <Icons.chevronLeft size={15} /> Back to studio
      </div>
      {SETTINGS_NAV.map((item) => {
        const I = Icons[item.icon];
        return (
          <div key={item.id} className={"sn-item" + (active === item.id ? " active" : "")} onClick={() => onSelect(item.id)}>
            <span className="sn-icon"><I size={16} /></span>
            {item.label}
          </div>
        );
      })}
    </div>
  );
}

/* — Endpoints (stateful CRUD) — */
function EndpointRowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span className="ep-menu">
      <button className="icon-btn" onClick={() => setOpen((s) => !s)}><Icons.more size={16} /></button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="row-menu right">
            <div className="rm-item" onClick={() => { setOpen(false); onEdit(); }}><Icons.edit size={14} /> Edit</div>
            <div className="rm-item danger" onClick={() => { setOpen(false); onDelete(); }}><Icons.trash size={14} /> Delete</div>
          </div>
        </>
      )}
    </span>
  );
}

function EndpointsPage({
  endpoints,
  onAdd,
  onEdit,
  onDelete
}: {
  endpoints: EndpointRow[]
  onAdd: () => void
  onEdit: (ep: EndpointRow) => void
  onDelete: (name: string) => void
}): ReactElement {
  return (
    <div className="sc-wrap">
      <div className="settings-title">Endpoints</div>
      <div className="settings-desc">Connect AI providers. Each endpoint exposes one or more models that your experts run on.</div>
      <div className="endpoint-list">
        {endpoints.map((ep) => (
          <div className="endpoint-row" key={ep.name}>
            <span className="er-health"><HealthDot status={ep.status} /></span>
            <span className="er-name">{ep.name}</span>
            <span className="er-proto">{ep.proto}</span>
            <span className={"er-status " + ep.status}>{ep.status}</span>
            <span className="er-models">{ep.models.length} models</span>
            <span className="er-key">key {ep.key}</span>
            <span className="er-actions">
              <button className="btn sm ghost" onClick={() => onEdit(ep)}>Edit</button>
              <EndpointRowMenu onEdit={() => onEdit(ep)} onDelete={() => onDelete(ep.name)} />
            </span>
          </div>
        ))}
        {endpoints.length === 0 && <div className="endpoint-row" style={{ color: "var(--text-4)", fontSize: 13 }}>No endpoints configured yet.</div>}
        <div className="add-endpoint-row" onClick={onAdd}>
          <Icons.plus size={15} /> Add endpoint
        </div>
      </div>
    </div>
  );
}

/* — Roles binding table (interactive) — */
function RoleBindRow({
  expert,
  binding,
  endpoints,
  onChange
}: {
  expert: Expert
  binding: RoleBinding
  endpoints: EndpointRow[]
  onChange: (patch: Partial<RoleBinding> & { endpoint?: string }) => void
}): ReactElement {
  const familyLabel: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" };
  const epOpts = endpoints.map((ep) => ({ v: ep.name, l: ep.name }));
  const family = binding.family;
  const epName = (binding as RoleBinding & { endpoint?: string }).endpoint || (endpoints.find((e) => e.proto === family) || {}).name || endpoints[0].name;
  const selectedEp = endpoints.find((e) => e.name === epName);
  const modelOpts = (selectedEp?.models ?? []).map((m) => ({ v: m, l: m }));
  const safeModelOpts = modelOpts.length > 0 ? modelOpts : [{ v: "", l: "— no models —" }];

  return (
    <div className="role-bind-row">
      <div className="rb-role">
        <Avatar expert={expert} size={26} />
        <span className="rb-name">{expert.name}</span>
      </div>
      <div className="rb-binding">
        <span className={"proto-chip " + family}><span className="pc-dot" /> {familyLabel[family as string]}</span>
        <div className="rb-controls">
          <div style={{ width: 150 }}>
            <Dropdown options={epOpts} value={epName}
              onChange={(v: string) => { const ep = endpoints.find((e) => e.name === v); onChange({ endpoint: v, family: ep?.proto as Family, model: ep?.models[0] ?? "" }); }} />
          </div>
          {/* Model options are the selected endpoint's configured slug list (set in the endpoint
              dialog). Switching endpoint repopulates them and resets to its first model. */}
          <div style={{ width: 168 }}>
            <Dropdown options={safeModelOpts} value={binding.model} onChange={(v: string) => onChange({ model: v })} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RolesPage({ endpoints, onAddEndpoint }: { endpoints: EndpointRow[]; onAddEndpoint: () => void }): ReactElement {
  const { ROLE_BINDINGS, EXPERT_BY_ID, EXPERTS } = STUDIO_DATA;
  const roles = useRoles();
  const [bindings, setBindings] = useState<RoleBinding[]>(ROLE_BINDINGS);
  const ci = EXPERTS.find((e) => e.unconfigured && !roles.isDeleted(e.id));
  const update = (id: string, patch: Partial<RoleBinding>): void => setBindings((p) => p.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  return (
    <div className="sc-wrap">
      <div className="settings-title">Roles</div>
      <div className="settings-desc">Bind each expert to the endpoint and model best suited to its job. Three protocol families, each doing what it's best at.</div>
      <div className="family-legend">
        <div className="fl-item"><span className="proto-chip anthropic"><span className="pc-dot" /> Anthropic</span> reasoning &amp; code</div>
        <div className="fl-item"><span className="proto-chip openai"><span className="pc-dot" /> OpenAI</span> general &amp; analysis</div>
        <div className="fl-item"><span className="proto-chip gemini"><span className="pc-dot" /> Gemini</span> translation &amp; images</div>
      </div>
      <div className="roles-table">
        <div className="roles-thead">
          <span className="th-role">Expert</span>
          <span className="th-binding">Endpoint &amp; model</span>
        </div>
        {bindings.map((b) => (
          <RoleBindRow key={b.id} expert={EXPERT_BY_ID[b.id]} binding={b} endpoints={endpoints} onChange={(patch) => update(b.id, patch)} />
        ))}
        {/* unconfigured custom role */}
        {ci && (
          <div className="role-bind-row disabled">
            <div className="rb-role">
              <Avatar expert={ci} size={26} />
              <span className="rb-name">{ci.name}</span>
            </div>
            <div className="rb-binding">
              <span className="rb-needs"><Icons.alert size={14} /> Needs an endpoint</span>
              <div className="rb-controls">
                <button className="mini-select" onClick={onAddEndpoint}>Add endpoint <Icons.arrowRight size={12} /></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GenericSettingsPage({ id }: { id: string }): ReactElement {
  const map: Record<string, { title: string; desc: string }> = {
    general: { title: "General", desc: "Appearance, language, and startup behavior. (Dark theme is the only theme in v0.1.)" },
    privacy: { title: "Privacy", desc: "Your keys, conversations, and memory stay on this device. Nothing is sent to NicoSoft servers." },
    about:   { title: "About", desc: "NicoSoft AI Studio · v0.1.0 · open source. A desktop workspace where a team of named AI experts works for you." },
  };
  const m = map[id] || map.general;
  return (
    <div className="sc-wrap">
      <div className="settings-title">{m.title}</div>
      <div className="settings-desc">{m.desc}</div>
      <div style={{ padding: "40px 0", color: "var(--text-4)", fontSize: 13, textAlign: "center", border: "1px dashed var(--border-1)", borderRadius: 8 }}>
        {m.title} settings
      </div>
    </div>
  );
}

export function SettingsView({
  tab,
  onTab,
  onBack
}: {
  tab: string
  onTab: (tab: string) => void
  onBack: () => void
}): ReactElement {
  const { ENDPOINTS } = STUDIO_DATA;
  const [endpoints, setEndpoints] = useState<EndpointRow[]>(ENDPOINTS);
  const [dialog, setDialog] = useState<{ editing: EndpointRow | null } | null>(null); // { editing: ep | null }

  const openAdd = (): void => setDialog({ editing: null });
  const openEdit = (ep: EndpointRow): void => setDialog({ editing: ep });
  const del = (name: string): void => setEndpoints((p) => p.filter((e) => e.name !== name));
  const save = (ep: EndpointRow, initial: EndpointRow | null): void => {
    setEndpoints((p) => {
      if (initial) return p.map((x) => (x.name === initial.name ? { ...x, ...ep } : x));
      return [...p, ep];
    });
    setDialog(null);
  };

  return (
    <div className="settings-body">
      <SettingsNav active={tab} onSelect={onTab} onBack={onBack} />
      <div className="settings-content">
        {tab === "profile" && <ProfilePage />}
        {tab === "memory" && <MemorySettings />}
        {tab === "endpoints" && <EndpointsPage endpoints={endpoints} onAdd={openAdd} onEdit={openEdit} onDelete={del} />}
        {tab === "roles" && <RolesPage endpoints={endpoints} onAddEndpoint={openAdd} />}
        {(tab === "general" || tab === "privacy" || tab === "about") && <GenericSettingsPage id={tab} />}
      </div>
      {dialog && <EndpointDialog initial={dialog.editing} onClose={() => setDialog(null)} onSave={save} />}
    </div>
  );
}
