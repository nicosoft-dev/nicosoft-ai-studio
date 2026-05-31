/* ============================================================
   NicoSoft AI Studio — Settings
   Profile · Memory · Endpoints · Roles · General · Privacy · About
   ============================================================ */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar, HealthDot } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import { useRoles } from '@/stores/roles'
import { EndpointDialog } from '@/components/dialogs'
import { ProfilePage, Dropdown } from '@/views/profile'
import { MemorySettings } from '@/views/memory'
import type { Expert } from '@/types'
import type { EndpointDto, EndpointInput } from '@/lib/api'
import { THINKING_OPTIONS } from '@/lib/thinking'
import { useRoleBinding, FAMILY_LABEL } from '@/lib/use-role-binding'

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
  endpoints: EndpointDto[]
  onAdd: () => void
  onEdit: (ep: EndpointDto) => void
  onDelete: (id: string) => void
}): ReactElement {
  return (
    <div className="sc-wrap">
      <div className="settings-title">Endpoints</div>
      <div className="settings-desc">Connect AI providers. Each endpoint exposes one or more models that your experts run on.</div>
      <div className="endpoint-list">
        {endpoints.map((ep) => {
          const health = ep.enabled ? 'healthy' : 'idle'
          return (
            <div className="endpoint-row" key={ep.id}>
              <span className="er-health"><HealthDot status={health} /></span>
              <span className="er-name">{ep.name}</span>
              <span className="er-proto">{ep.protocol}</span>
              <span className={"er-status " + health}>{ep.enabled ? 'enabled' : 'disabled'}</span>
              <span className="er-models">{ep.availableModels.length} models</span>
              <span className="er-key">{ep.hasKey ? 'key set' : 'no key'}</span>
              <span className="er-actions">
                <button className="btn sm ghost" onClick={() => onEdit(ep)}>Edit</button>
                <EndpointRowMenu onEdit={() => onEdit(ep)} onDelete={() => onDelete(ep.id)} />
              </span>
            </div>
          )
        })}
        {endpoints.length === 0 && <div className="endpoint-row" style={{ color: "var(--text-4)", fontSize: 13 }}>No endpoints configured yet.</div>}
        <div className="add-endpoint-row" onClick={onAdd}>
          <Icons.plus size={15} /> Add endpoint
        </div>
      </div>
    </div>
  );
}

/* — Roles binding table (interactive, persisted) — */
function RoleBindRow({ expert }: { expert: Expert }): ReactElement {
  const b = useRoleBinding(expert);
  return (
    <div className="role-bind-row">
      <div className="rb-role">
        <Avatar expert={expert} size={26} />
        <span className="rb-name">{expert.name}</span>
      </div>
      <div className="rb-binding">
        <span className={"proto-chip " + (b.family ?? 'openai')}><span className="pc-dot" /> {FAMILY_LABEL[b.family ?? 'openai']}</span>
        <div className="rb-controls">
          <div style={{ width: 150 }}>
            <Dropdown options={b.endpoints.map((e) => ({ v: e.id, l: e.name }))} value={b.endpointId} onChange={b.onEndpoint} />
          </div>
          {/* Model options are the selected endpoint's configured slug list (set in the endpoint
              dialog). Switching endpoint repopulates them and resets to its first model. */}
          <div style={{ width: 168 }}>
            <Dropdown
              options={(b.models.length ? b.models : ['']).map((m) => ({ v: m, l: m || '— no models —' }))}
              value={b.model}
              onChange={b.onModel}
            />
          </div>
          {b.depths.length > 0 && (
            <div style={{ width: 150 }}>
              <Dropdown
                options={[
                  { v: '', l: 'Default thinking' },
                  ...THINKING_OPTIONS.filter((t) => b.depths.includes(t.value)).map((t) => ({ v: t.value, l: t.label }))
                ]}
                value={b.depth}
                onChange={b.onDepth}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RolesPage({ onAddEndpoint }: { onAddEndpoint: () => void }): ReactElement {
  const { EXPERTS } = STUDIO_DATA;
  const roles = useRoles();
  const bindable = EXPERTS.filter((e) => !e.unconfigured && !roles.isDeleted(e.id));
  const ci = EXPERTS.find((e) => e.unconfigured && !roles.isDeleted(e.id));

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
        {bindable.map((e) => (
          <RoleBindRow key={e.id} expert={e} />
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
  const [endpoints, setEndpoints] = useState<EndpointDto[]>([]);
  const [dialog, setDialog] = useState<{ editing: EndpointDto | null } | null>(null);

  const reload = (): void => { void window.api.endpoints.list().then(setEndpoints); };
  useEffect(() => { reload(); }, []);

  const openAdd = (): void => setDialog({ editing: null });
  const openEdit = (ep: EndpointDto): void => setDialog({ editing: ep });
  const del = (id: string): void => { void window.api.endpoints.remove(id).then(reload); };
  const save = (input: EndpointInput, id: string | null): void => {
    const p = id ? window.api.endpoints.update(id, input) : window.api.endpoints.add(input);
    void p.then(() => { reload(); setDialog(null); });
  };

  return (
    <div className="settings-body">
      <SettingsNav active={tab} onSelect={onTab} onBack={onBack} />
      <div className="settings-content">
        {tab === "profile" && <ProfilePage />}
        {tab === "memory" && <MemorySettings />}
        {tab === "endpoints" && <EndpointsPage endpoints={endpoints} onAdd={openAdd} onEdit={openEdit} onDelete={del} />}
        {tab === "roles" && <RolesPage onAddEndpoint={openAdd} />}
        {(tab === "general" || tab === "privacy" || tab === "about") && <GenericSettingsPage id={tab} />}
      </div>
      {dialog && <EndpointDialog initial={dialog.editing} onClose={() => setDialog(null)} onSave={save} />}
    </div>
  );
}
