/* ============================================================
   NicoSoft AI Studio — Projects
   A Project = the team completing a whole piece of work.
   Goal · Plan · Execute · Test, with a phase rail. (mock)
   ============================================================ */
import { Fragment } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar, AvatarStack } from '@/components/primitives'
import { STUDIO_DATA, PHASES, PHASE_INDEX } from '@/data/studio-data'
import type { Project } from '@/types'

const PHASE_CHIP: Record<string, { cls: string; label: string }> = {
  Planning: { cls: "planning", label: "Planning" },
  Executing: { cls: "executing", label: "Executing" },
  Testing: { cls: "testing", label: "Testing" },
  Done: { cls: "done", label: "Done" },
};
const TASK_STATUS: Record<string, { cls: string; label: string }> = {
  todo: { cls: "todo", label: "To do" },
  doing: { cls: "doing", label: "Doing" },
  done: { cls: "done", label: "Done" },
};

function PhaseChip({ phase }: { phase: string }): ReactElement {
  const m = PHASE_CHIP[phase] || PHASE_CHIP.Planning;
  return <span className={"phase-chip " + m.cls}>{m.label}</span>;
}

function ProgressBar({ value }: { value: number }): ReactElement {
  return <span className="proj-progress"><span className="proj-progress-fill" style={{ width: Math.round(value * 100) + "%" }} /></span>;
}

/* — Projects list — */
function ProjectsList({ onOpen }: { onOpen: (id: string) => void }): ReactElement {
  const { PROJECTS } = STUDIO_DATA;
  return (
    <div className="main-col">
      <div className="conv-header">
        <span className="conv-title">Projects</span>
        <span className="conv-sub" style={{ marginLeft: "auto" }}>{PROJECTS.length} active</span>
      </div>
      <div className="proj-list-body">
        <div className="proj-list">
          {PROJECTS.map((p) => (
            <div className="proj-card" key={p.id} onClick={() => onOpen(p.id)}>
              <div className="pc-top">
                <span className="pc-title">{p.title}</span>
                <PhaseChip phase={p.phase} />
              </div>
              <div className="pc-goal">{p.summary}</div>
              <div className="pc-foot">
                <AvatarStack ids={p.experts} size={24} />
                <ProgressBar value={p.progress} />
                <span className="pc-pct">{Math.round(p.progress * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* — Phase rail: Plan → Execute → Test → Done — */
function PhaseRail({ phase }: { phase: string }): ReactElement {
  const cur = PHASE_INDEX[phase] ?? 0;
  return (
    <div className="phase-rail">
      {PHASES.map((ph, i) => (
        <Fragment key={ph}>
          <div className={"pr-step" + (i < cur ? " past" : i === cur ? " current" : "")}>
            <span className="pr-dot">{i < cur ? <Icons.check size={12} /> : i + 1}</span>
            <span className="pr-label">{ph}</span>
          </div>
          {i < PHASES.length - 1 && <span className={"pr-line" + (i < cur ? " past" : "")} />}
        </Fragment>
      ))}
    </div>
  );
}

function TaskStatusTag({ status }: { status: string }): ReactElement {
  const m = TASK_STATUS[status] || TASK_STATUS.todo;
  return (
    <span className={"task-status " + m.cls}>
      {status === "done" && <Icons.check size={11} />}
      {status === "doing" && <span className="ts-pulse" />}
      {m.label}
    </span>
  );
}

/* — Project detail — */
function ProjectDetail({ project, onBack, onOpenExpert }: { project: Project; onBack: () => void; onOpenExpert: (id: string) => void }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA;
  const depTitle = (id: string): string => { const t = project.plan.find((x) => x.id === id); return t ? t.title : id; };
  return (
    <div className="main-col">
      <div className="conv-header">
        <button className="btn ghost sm" onClick={onBack}><Icons.chevronLeft size={15} /> Projects</button>
        <span className="conv-title" style={{ marginLeft: 6 }}>{project.title}</span>
        <PhaseChip phase={project.phase} />
      </div>
      <div className="proj-detail-body">
        <div className="proj-detail-inner">
          <PhaseRail phase={project.phase} />

          {/* Goal */}
          <div className="proj-section">
            <div className="ps-head"><span className="ps-icon"><Icons.target size={15} /></span> Goal</div>
            <div className="proj-goal">{project.goal}</div>
            <div className="proj-chair">
              <span className="pchair-label">Chaired by</span>
              <span className="pchair-expert" onClick={() => onOpenExpert(project.chair)}>
                <Avatar expert={EXPERT_BY_ID[project.chair]} size={20} /> {EXPERT_BY_ID[project.chair].name}
              </span>
              <span className="pchair-team"><AvatarStack ids={project.experts} size={22} /></span>
            </div>
          </div>

          {/* Plan */}
          <div className="proj-section">
            <div className="ps-head"><span className="ps-icon"><Icons.listChecks size={15} /></span> Plan <span className="ps-sub">— task breakdown · Atlas chairs</span></div>
            <div className="plan-list">
              {project.plan.map((t, i) => {
                const e = EXPERT_BY_ID[t.expert];
                return (
                  <div className="plan-row" key={t.id}>
                    <span className="plan-num">{i + 1}</span>
                    <div className="plan-main">
                      <div className="plan-title">{t.title}</div>
                      {t.deps.length > 0 && (
                        <div className="plan-deps"><Icons.gitBranch size={11} /> needs {t.deps.map(depTitle).join(", ")}</div>
                      )}
                    </div>
                    <span className="plan-expert" onClick={() => onOpenExpert(t.expert)} title={e.name}>
                      <Avatar expert={e} size={22} />
                    </span>
                    <TaskStatusTag status={t.status} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Execute */}
          <div className="proj-section">
            <div className="ps-head"><span className="ps-icon"><Icons.kanban size={15} /></span> Execute <span className="ps-sub">— the plan in progress</span></div>
            <div className="exec-timeline">
              {project.plan.map((t) => {
                const e = EXPERT_BY_ID[t.expert];
                return (
                  <div className={"exec-row " + t.status} key={t.id}>
                    <span className="exec-rail"><span className={"exec-dot " + t.status} style={t.status !== "todo" ? { background: e.color } : undefined} /></span>
                    <div className="exec-card">
                      <div className="exec-head">
                        <Avatar expert={e} size={22} />
                        <span className="exec-expert">{e.name}</span>
                        <span className="exec-task">{t.title}</span>
                        <TaskStatusTag status={t.status} />
                      </div>
                      {t.output && <div className="exec-output">{t.output}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Test / Review */}
          <div className="proj-section">
            <div className="ps-head"><span className="ps-icon"><Icons.check size={15} /></span> Test &amp; review <span className="ps-sub">— acceptance checks</span></div>
            <div className="test-list">
              {project.tests.map((v) => (
                <div className="test-row" key={v.id}>
                  <span className={"test-check " + v.status}>
                    {v.status === "pass" ? <Icons.check size={13} /> : <span className="test-pending-dot" />}
                  </span>
                  <span className="test-title">{v.title}</span>
                  <span className={"test-tag " + v.status}>{v.status === "pass" ? "passed" : "pending"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectsView({ activeProject, onSelect, onOpenExpert }: { activeProject: string | null; onSelect: (id: string | null) => void; onOpenExpert: (id: string) => void }): ReactElement {
  const { PROJECTS } = STUDIO_DATA;
  const project = activeProject ? PROJECTS.find((p) => p.id === activeProject) : null;
  if (project) return <ProjectDetail project={project} onBack={() => onSelect(null)} onOpenExpert={onOpenExpert} />;
  return <ProjectsList onOpen={onSelect} />;
}
