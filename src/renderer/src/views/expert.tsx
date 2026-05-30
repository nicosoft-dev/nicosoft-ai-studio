/* ============================================================
   NicoSoft AI Studio — Expert detail page
   Profile · model binding · memory (3 layers) · equipped · recents
   ============================================================ */
import { useState } from 'react'
import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { STUDIO_DATA } from '@/data/studio-data'
import type { Expert, MemoryItem, RoleBinding } from '@/types'
import { Icons } from '@/components/icons'
import { useRoles } from '@/stores/roles'
import { Avatar } from '@/components/primitives'
import { Dropdown } from '@/views/profile'
import { ConfirmDialog } from '@/components/dialogs'
import { MemToggle, MemoryLayer } from '@/views/memory'

type ConfigurableFamily = 'anthropic' | 'openai' | 'gemini'

interface EquippedItem {
  type: 'mcp' | 'skill'
  name: string
  all?: boolean
}

function InlineBinding({
  expert,
  binding,
  onOpenEndpoint
}: {
  expert: Expert
  binding: RoleBinding | undefined
  onOpenEndpoint: () => void
}): ReactElement {
  const { ENDPOINTS } = STUDIO_DATA
  const familyLabel: Record<ConfigurableFamily, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" }
  const modelsByFamily: Record<ConfigurableFamily, string[]> = {
    anthropic: ["claude-haiku-4", "claude-sonnet-4.6", "claude-opus-4"],
    openai: ["gpt-5-mini", "gpt-5", "gpt-5-pro"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "imagen-4"],
  };
  const endpointOpts = ENDPOINTS.map((ep) => ({ v: ep.name, l: ep.name }))
  const [endpoint, setEndpoint] = useState(() => {
    const ep = ENDPOINTS.find((x) => x.proto === (binding && binding.family));
    return ep ? ep.name : ENDPOINTS[0].name;
  });
  const family = (ENDPOINTS.find((x) => x.name === endpoint)?.proto || "anthropic") as ConfigurableFamily
  const [model, setModel] = useState((binding && binding.model) || modelsByFamily[family][0]);

  if (expert.unconfigured) {
    return (
      <div className="detail-card unconfigured">
        <div className="rb-needs"><Icons.alert size={15} /> No endpoint bound — this role can't run yet.</div>
        <button className="btn primary sm" onClick={onOpenEndpoint}><Icons.plus size={14} /> Add endpoint</button>
      </div>
    );
  }
  return (
    <div className="detail-card binding-card">
      <span className={"proto-chip " + family}><span className="pc-dot" /> {familyLabel[family]}</span>
      <div className="bind-selects">
        <div style={{ width: 200 }}>
          <Dropdown options={endpointOpts} value={endpoint}
            onChange={(v: string) => { setEndpoint(v); const f = ENDPOINTS.find((x) => x.name === v)?.proto as ConfigurableFamily | undefined; if (f && modelsByFamily[f]) setModel(modelsByFamily[f][0]); }} icon="plug" />
        </div>
        <div style={{ width: 200 }}>
          <Dropdown options={modelsByFamily[family].map((m) => ({ v: m, l: m }))} value={model} onChange={setModel} icon="sparkle" />
        </div>
      </div>
    </div>
  );
}

function EquippedSection({ expertId }: { expertId: string }): ReactElement {
  const { EXTENSIONS } = STUDIO_DATA
  const initial: EquippedItem[] = [
    ...EXTENSIONS.mcp.filter((m) => m.scope === "all" || (Array.isArray(m.scope) && m.scope.includes(expertId)))
      .map((m) => ({ type: "mcp" as const, name: m.name, all: m.scope === "all" })),
    ...EXTENSIONS.skills.filter((s) => s.enabled && (s.scope === "all" || (Array.isArray(s.scope) && s.scope.includes(expertId))))
      .map((s) => ({ type: "skill" as const, name: s.name, all: s.scope === "all" })),
  ];
  const [equipped, setEquipped] = useState<EquippedItem[]>(initial);
  const [menu, setMenu] = useState(false);

  const all: EquippedItem[] = [
    ...EXTENSIONS.mcp.map((m) => ({ type: "mcp" as const, name: m.name })),
    ...EXTENSIONS.skills.map((s) => ({ type: "skill" as const, name: s.name })),
  ];
  const available = all.filter((a) => !equipped.some((q) => q.type === a.type && q.name === a.name));
  const remove = (item: EquippedItem): void => setEquipped((p) => p.filter((q) => !(q.type === item.type && q.name === item.name)));
  const add = (item: EquippedItem): void => { setEquipped((p) => [...p, { ...item, all: false }]); setMenu(false); };

  return (
    <div className="detail-section">
      <div className="ds-head">
        <span className="ds-title">Equipped capabilities</span>
        <div className="ds-add">
          <button className="btn ghost sm" onClick={() => setMenu((s) => !s)}><Icons.plus size={14} /> Equip</button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(false)} />
              <div className="row-menu right">
                {available.length === 0 ? <div className="rm-empty">Everything is equipped</div>
                  : available.map((a) => (
                    <div className="rm-item" key={a.type + a.name} onClick={() => add(a)}>
                      <Icons.plus size={13} /> <span className="rm-type">{a.type === "mcp" ? "MCP" : "Skill"}</span> {a.name}
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
      {equipped.length === 0 ? (
        <div className="detail-empty">No tools or skills equipped yet.</div>
      ) : (
        <div className="equip-list">
          {equipped.map((q) => {
            const I = q.type === "mcp" ? Icons.terminal : Icons.zap;
            return (
              <div className="equip-chip" key={q.type + q.name}>
                <span className="eq-ic"><I size={13} /></span>
                <span className="eq-type">{q.type === "mcp" ? "MCP" : "Skill"}</span>
                <span className="eq-name">{q.name}</span>
                {q.all && <span className="eq-all">all experts</span>}
                <button className="eq-x" onClick={() => remove(q)} title="Remove"><Icons.x size={12} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MemorySection({ expertId }: { expertId: string }): ReactElement {
  const { MEMORY } = STUDIO_DATA
  const [shared, setShared] = useState(MEMORY.shared);
  const [role, setRole] = useState((MEMORY.byExpert[expertId] || {}).role || []);
  const [collab, setCollab] = useState((MEMORY.byExpert[expertId] || {}).collab || []);
  const [learning, setLearning] = useState(MEMORY.selfLearning.perExpert[expertId] !== false);

  const mkEdit = (set: Dispatch<SetStateAction<MemoryItem[]>>) => (id: string, text: string): void => set((p) => p.map((m) => (m.id === id ? { ...m, text } : m)));
  const mkDel = (set: Dispatch<SetStateAction<MemoryItem[]>>) => (id: string): void => set((p) => p.filter((m) => m.id !== id));
  const empty = shared.length + role.length + collab.length === 0;

  return (
    <div className="detail-section">
      <div className="ds-head">
        <span className="ds-title">Memory <span className="ds-sub">— what this expert remembers about you</span></span>
        <label className="learn-toggle">
          <span>Self-learning</span>
          <MemToggle on={learning} onClick={() => setLearning((s) => !s)} />
        </label>
      </div>
      {empty ? (
        <div className="detail-empty">Nothing remembered yet — memories form as you chat.</div>
      ) : (
        <div className="mem-layers">
          <MemoryLayer layer="SHARED" items={shared} onEdit={mkEdit(setShared)} onDelete={mkDel(setShared)} />
          <MemoryLayer layer="ROLE" items={role} onEdit={mkEdit(setRole)} onDelete={mkDel(setRole)} />
          <MemoryLayer layer="COLLAB" items={collab} onEdit={mkEdit(setCollab)} onDelete={mkDel(setCollab)} />
        </div>
      )}
    </div>
  );
}

export function ExpertDetail({
  expertId,
  onChat,
  onOpenConv,
  onOpenEndpoint,
  onDeleted
}: {
  expertId: string
  onChat: (id: string) => void
  onOpenConv: (id: string) => void
  onOpenEndpoint: () => void
  onDeleted?: () => void
}): ReactElement {
  const { EXPERT_BY_ID, ROLE_BINDINGS, HISTORY } = STUDIO_DATA
  const roles = useRoles();
  const [confirm, setConfirm] = useState(false);
  const e = EXPERT_BY_ID[expertId];
  const binding = ROLE_BINDINGS.find((b) => b.id === expertId);
  const recents = HISTORY.flatMap((g) => g.items.filter((it) => it.expert === expertId).map((it) => ({ ...it, group: g.group })));
  const roleDisabled = roles.isDisabled(expertId);

  return (
    <div className="main-col">
      <div className="conv-header">
        <span className="conv-title">Profile</span>
        <button className="btn secondary sm" style={{ marginLeft: "auto" }} onClick={() => onChat(expertId)}>
          <Icons.message size={14} /> Start a conversation
        </button>
      </div>
      <div className="detail-body">
        <div className="detail-inner">
          {/* hero */}
          <div className="detail-hero">
            <Avatar expert={e} size={56} />
            <div className="dh-meta">
              <div className="dh-name">
                {e.name}
                {e.coordinator && <span className="dh-badge">coordinator</span>}
                {e.custom && <span className="dh-badge custom">custom</span>}
              </div>
              <div className="dh-spec">{e.specialty}</div>
              <div className="dh-personality">{e.personality}.</div>
            </div>
            {e.coordinator ? (
              <div className="role-enable-pill primary"><Icons.shield size={14} /> Primary role · always on</div>
            ) : (
              <div className="role-enable-pill">
                <span>{roleDisabled ? "Role disabled" : "Role enabled"}</span>
                <MemToggle on={!roleDisabled} onClick={() => roles.toggle(expertId)} />
              </div>
            )}
          </div>

          {/* model binding */}
          <div className="detail-section">
            <div className="ds-head"><span className="ds-title">Model</span><span className="ds-hint">endpoint &amp; model this role runs on</span></div>
            <InlineBinding expert={e} binding={binding} onOpenEndpoint={onOpenEndpoint} />
          </div>

          {/* memory */}
          <MemorySection expertId={expertId} />

          {/* equipped */}
          <EquippedSection expertId={expertId} />

          {/* recents */}
          <div className="detail-section">
            <div className="ds-head"><span className="ds-title">Recent conversations</span></div>
            {recents.length === 0 ? (
              <div className="detail-empty">No conversations with {e.name} yet.</div>
            ) : (
              <div className="recent-list">
                {recents.map((r) => (
                  <div className="recent-row" key={r.id} onClick={() => onOpenConv(r.id)}>
                    <span className="hist-dot" style={{ background: e.color }} />
                    <span className="recent-title">{r.title}</span>
                    <span className="recent-when">{r.group}</span>
                    <Icons.chevronRight size={14} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* danger zone — custom roles only */}
          {e.custom && (
            <div className="detail-section">
              <div className="ds-head"><span className="ds-title">Danger zone</span></div>
              <div className="detail-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>Delete this custom role. Past conversations stay in History.</span>
                <button className="btn danger sm" onClick={() => setConfirm(true)}><Icons.trash size={14} /> Delete role</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {confirm && (
        <ConfirmDialog title={`Delete ${e.name}?`}
          body={`This removes the ${e.name} role and its bindings. Past conversations stay in your History. This can't be undone.`}
          confirmLabel="Delete role" danger
          onConfirm={() => { roles.remove(expertId); onDeleted && onDeleted(); }} onClose={() => setConfirm(false)} />
      )}
    </div>
  );
}
