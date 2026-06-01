/* ============================================================
   NicoSoft AI Studio — Scheduled
   Timed tasks that fire an orchestrated step chain. (mock)
   Email always routes through an email MCP / Scheduler draft —
   Studio never sends mail itself.
   ============================================================ */
import { Fragment, useState } from 'react'
import type { ReactElement } from 'react'
import { STUDIO_DATA } from '@/data/studio-data'
import type { ScheduledStep, ScheduledTask } from '@/types'
import { Avatar } from '@/components/primitives'
import { Icons } from '@/components/icons'
import { Dropdown } from '@/views/profile'
import { MemToggle } from '@/views/memory'

const TRIGGER_TYPES = [
  { v: "once", l: "Once" },
  { v: "daily", l: "Daily" },
  { v: "weekly", l: "Weekly" },
  { v: "cron", l: "Cron" },
];
const STEP_KINDS = [
  { v: "expert", l: "Expert" },
  { v: "tool", l: "Tool / MCP" },
  { v: "email", l: "Send email" },
  { v: "project", l: "Project" },
];

function StepChip({ step }: { step: ScheduledStep }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA;
  if (step.kind === "expert") {
    const e = EXPERT_BY_ID[step.expert!];
    return <span className="step-chip"><Avatar expert={e} size={18} /> {e.name}</span>;
  }
  if (step.kind === "email") return <span className="step-chip"><Icons.mail size={13} /> Email MCP</span>;
  if (step.kind === "project") return <span className="step-chip"><Icons.kanban size={13} /> Project</span>;
  return <span className="step-chip"><Icons.puzzle size={13} /> Tool</span>;
}

/* — Scheduled list — */
function ScheduledList({
  tasks,
  onToggle,
  onEdit,
  onNew
}: {
  tasks: ScheduledTask[]
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onNew: () => void
}): ReactElement {
  return (
    <div className="main-col">
      <div className="conv-header">
        <span className="conv-title">Scheduled</span>
        <button className="btn secondary sm" style={{ marginLeft: "auto" }} onClick={onNew}><Icons.plus size={14} /> New task</button>
      </div>
      <div className="sched-body">
        <div className="sched-inner">
          <div className="sched-note">Timed tasks fire an orchestrated step chain. Email always goes through an email MCP or a Scheduler draft — Studio never sends mail itself.</div>
          <div className="sched-list">
            {tasks.map((t) => (
              <div className={"sched-row" + (t.enabled ? "" : " off")} key={t.id}>
                <span className="sched-trig-ic">{t.trigger.type === "once" ? <Icons.clock size={16} /> : <Icons.repeat size={16} />}</span>
                <div className="sched-main" onClick={() => onEdit(t.id)}>
                  <div className="sched-name-line">
                    <span className="sched-name">{t.name}</span>
                    <span className="sched-trigger">{t.trigger.label}</span>
                  </div>
                  <div className="sched-chain">
                    {t.steps.map((s, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="sched-arrow"><Icons.arrowRight size={12} /></span>}
                        <StepChip step={s} />
                      </Fragment>
                    ))}
                  </div>
                </div>
                <div className="sched-meta">
                  <span className="sched-next">Next · {t.nextRun}</span>
                  <span className={"sched-last " + t.lastRun.result}>
                    <span className="sl-dot" /> Last · {t.lastRun.when}
                  </span>
                </div>
                <MemToggle on={t.enabled} onClick={() => onToggle(t.id)} />
                <button className="icon-btn" title="Edit" onClick={() => onEdit(t.id)}><Icons.edit size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* — Create / edit a scheduled task — */
function ScheduledEditor({ task, onBack }: { task: ScheduledTask | null; onBack: () => void }): ReactElement {
  const { EXPERTS, EXPERT_BY_ID } = STUDIO_DATA;
  const [name, setName] = useState(task ? task.name : "New scheduled task");
  const [trigger, setTrigger] = useState(task ? task.trigger.type : "weekly");
  const [when, setWhen] = useState(task ? task.trigger.label : "Mon 9:00");
  const [steps, setSteps] = useState<ScheduledStep[]>(task ? task.steps : [{ kind: "expert", expert: "analyst", text: "Analyze last week's metrics." }]);
  const expertOpts = EXPERTS.filter((e) => !e.unconfigured).map((e) => ({ v: e.id, l: e.name }));

  const setStep = (i: number, patch: Partial<ScheduledStep>): void => setSteps((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = (): void => setSteps((p) => [...p, { kind: "expert", expert: "generalist", text: "" }]);
  const removeStep = (i: number): void => setSteps((p) => p.filter((_, j) => j !== i));
  const move = (i: number, dir: number): void => setSteps((p) => {
    const j = i + dir; if (j < 0 || j >= p.length) return p;
    const n = [...p]; const tmp = n[i]; n[i] = n[j]; n[j] = tmp; return n;
  });

  return (
    <div className="main-col">
      <div className="conv-header">
        <button className="btn ghost sm" onClick={onBack}><Icons.chevronLeft size={15} /> Scheduled</button>
        <span className="conv-title" style={{ marginLeft: 6 }}>{task ? "Edit task" : "New task"}</span>
      </div>
      <div className="sched-body">
        <div className="sched-inner editor">
          <div className="pf-field">
            <label className="field-label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="pf-grid">
            <div className="pf-field">
              <label className="field-label">Trigger</label>
              <div className="segmented">
                {TRIGGER_TYPES.map((tt) => (
                  <button key={tt.v} className={trigger === tt.v ? "active" : ""} onClick={() => setTrigger(tt.v)}>{tt.l}</button>
                ))}
              </div>
            </div>
            <div className="pf-field">
              <label className="field-label">{trigger === "cron" ? "Cron expression" : "When"}</label>
              <input className={"input" + (trigger === "cron" ? " mono" : "")} value={when} onChange={(e) => setWhen(e.target.value)}
                placeholder={trigger === "cron" ? "0 9 * * 1" : "Mon 9:00"} />
            </div>
          </div>

          <div className="pf-field">
            <label className="field-label">Orchestration · ordered steps</label>
            <div className="step-editor">
              {steps.map((s, i) => {
                const e = s.expert ? EXPERT_BY_ID[s.expert] : null;
                return (
                  <div className="step-edit-row" key={i}>
                    <span className="se-num">{i + 1}</span>
                    <div className="se-body">
                      <div className="se-top">
                        <div style={{ width: 130 }}>
                          <Dropdown options={STEP_KINDS} value={s.kind} onChange={(v) => setStep(i, { kind: v as ScheduledStep['kind'] })} />
                        </div>
                        {s.kind === "expert" && (
                          <div style={{ width: 130 }}>
                            <Dropdown options={expertOpts} value={s.expert || "generalist"} onChange={(v) => setStep(i, { expert: v })} />
                          </div>
                        )}
                        <div className="se-reorder">
                          <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0}><Icons.chevronDown size={13} style={{ transform: "rotate(180deg)" }} /></button>
                          <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1}><Icons.chevronDown size={13} /></button>
                          <button className="icon-btn sm" onClick={() => removeStep(i)}><Icons.x size={13} /></button>
                        </div>
                      </div>
                      {s.kind === "expert" && (
                        <input className="input se-instr" value={s.text} onChange={(e2) => setStep(i, { text: e2.target.value })}
                          placeholder={`Instruction for ${e ? e.name : "the expert"}…`} />
                      )}
                      {s.kind === "email" && <div className="se-note"><Icons.mail size={13} /> Routed through the email MCP (Extensions) — Studio never sends mail itself.</div>}
                      {s.kind === "project" && <div className="se-note"><Icons.kanban size={13} /> Trigger or advance a Project.</div>}
                      {s.kind === "tool" && <div className="se-note"><Icons.puzzle size={13} /> Call an MCP tool from Extensions.</div>}
                    </div>
                  </div>
                );
              })}
              <button className="add-step" onClick={addStep}><Icons.plus size={14} /> Add step</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 9, marginTop: 4 }}>
            <button className="btn primary sm" onClick={onBack}>{task ? "Save task" : "Create task"}</button>
            <button className="btn ghost sm" onClick={onBack}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScheduledView(): ReactElement {
  const { SCHEDULED } = STUDIO_DATA;
  const [tasks, setTasks] = useState(SCHEDULED);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null); // { id } | { id: null } (new) | null (list)

  const toggle = (id: string): void => setTasks((p) => p.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));

  if (editing) {
    const task = editing.id ? tasks.find((t) => t.id === editing.id) ?? null : null;
    return <ScheduledEditor task={task} onBack={() => setEditing(null)} />;
  }
  return <ScheduledList tasks={tasks} onToggle={toggle} onEdit={(id) => setEditing({ id })} onNew={() => setEditing({ id: null })} />;
}
