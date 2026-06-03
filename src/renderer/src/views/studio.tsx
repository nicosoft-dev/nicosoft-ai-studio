/* ============================================================
   NicoSoft AI Studio — Studio Home
   Tab 1 "Activity": a live timeline (work in progress + collab
   projects only — never a permanent grid of idle experts).
   Tab 2 "Stats": local analytics (unchanged).
   ============================================================ */
import { Fragment, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Avatar, AvatarStack } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import { useRoles } from '@/stores/roles'
import { StatsPage } from '@/views/analytics'
import type { StudioModule } from '@/types'

type InProgressItem = StudioModule['timeline']['inProgress'][number]
type ProjectItem = StudioModule['timeline']['projects'][number]

/* — A single in-progress conversation row — */
function InProgressRow({ row, onOpenConv }: { row: InProgressItem; onOpenConv: (convId: string) => void }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA;
  const e = EXPERT_BY_ID[row.expert];
  return (
    <div className="tl-row" onClick={() => onOpenConv(row.convId)} style={{ "--ws-color": e.color } as CSSProperties}>
      <Avatar expert={e} size={30} />
      <div className="tl-main">
        <div className="tl-row-top">
          <span className="tl-name">{e.name}</span>
          <span className="tl-live"><span className="tl-dot working" style={{ background: e.color }} />live</span>
        </div>
        <div className="tl-title">{row.title}</div>
      </div>
      <div className="tl-meta">
        <span className="tl-progress">{row.progress}</span>
        <span className="tl-model">{e.model}</span>
      </div>
    </div>
  );
}

/* — A collaboration project (aggregate row) — opens the Project detail — */
function ProjectRow({ project, onOpenProject }: { project: ProjectItem; onOpenProject: (id: string) => void }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA;
  return (
    <div className="tl-project">
      <div className="tl-row project" onClick={() => onOpenProject(project.id)}>
        <AvatarStack ids={project.chain} />
        <div className="tl-main">
          <div className="tl-name">{project.title}</div>
          <div className="tl-chain">
            {project.chain.map((id, i) => {
              const e = EXPERT_BY_ID[id];
              return (
                <Fragment key={id}>
                  {i > 0 && <span className="tl-chain-sep">›</span>}
                  <span className="tl-chain-node"><span className="tl-chain-dot" style={{ background: e.color }} />{e.name}</span>
                </Fragment>
              );
            })}
          </div>
        </div>
        <div className="tl-meta">
          <span className="tl-status">{project.status}</span>
          <span className="tl-chevron"><Icons.chevronRight size={15} /></span>
        </div>
      </div>
    </div>
  );
}

/* — Idle state: a light "team ready" strip (no floor plan) — */
function TeamReady({ onOpenExpert }: { onOpenExpert: (id: string) => void }): ReactElement {
  const { EXPERTS } = STUDIO_DATA;
  const roles = useRoles();
  const team = EXPERTS.filter((e) => !roles.isDisabled(e.id) && !roles.isDeleted(e.id));
  return (
    <div className="team-ready">
      <div className="tr-prompt">Your team is ready — start a conversation or <span className="tr-at">@mention</span> an expert.</div>
      <div className="tr-chips">
        {team.map((e) => (
          <div className="tr-chip" key={e.id} onClick={() => onOpenExpert(e.id)}>
            <Avatar expert={e} size={26} />
            <div className="trc-meta">
              <div className="trc-name">{e.name}</div>
              <div className="trc-spec">{e.specialty.split("—")[1] ? e.specialty.split("—")[1].trim() : e.specialty}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityTimeline({
  onOpenExpert,
  onOpenConv,
  onOpenProject
}: {
  onOpenExpert: (id: string) => void
  onOpenConv: (convId: string) => void
  onOpenProject: (id: string) => void
}): ReactElement {
  const { STUDIO } = STUDIO_DATA;
  const tl = STUDIO.timeline;
  const [previewIdle, setPreviewIdle] = useState(false);
  const hasWork = !previewIdle && (tl.inProgress.length > 0 || tl.projects.length > 0);

  return (
    <div className="timeline-wrap">
      <div className="tl-scroll">
        {hasWork ? (
          <>
            {tl.inProgress.length > 0 && (
              <div className="tl-group">
                <div className="tl-group-head">
                  <span>In progress</span>
                  <span className="tl-count">{tl.inProgress.length}</span>
                </div>
                <div className="tl-list">
                  {tl.inProgress.map((row) => <InProgressRow key={row.convId} row={row} onOpenConv={onOpenConv} />)}
                </div>
              </div>
            )}

            {tl.projects.length > 0 && (
              <div className="tl-group">
                <div className="tl-group-head">
                  <span>Collaboration projects</span>
                  <span className="tl-preview">v0.3 preview</span>
                </div>
                <div className="tl-list">
                  {tl.projects.map((p) => <ProjectRow key={p.id} project={p} onOpenProject={onOpenProject} />)}
                </div>
              </div>
            )}
          </>
        ) : (
          <TeamReady onOpenExpert={onOpenExpert} />
        )}

        <div className="tl-foot">
          <span>{hasWork ? "Live work only · finished conversations move to History" : "Idle preview · nothing running right now"}</span>
          <button className="tl-idle-toggle" onClick={() => setPreviewIdle((s) => !s)}>
            {previewIdle ? "← Back to live work" : "Preview idle state"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudioStats(): ReactElement {
  const { STUDIO, EXPERT_BY_ID } = STUDIO_DATA;
  const s = STUDIO.stats;
  return (
    <div className="studio-stats">
      <div className="stats-section">
        <div className="stats-label">Today's usage</div>
        <div className="stat-big">{s.tokensToday}<span> tokens</span></div>
        <div className="stat-sub">{s.tokensIn} in · {s.tokensOut} out</div>
      </div>

      <div className="stats-section">
        <div className="stats-label">Conversations</div>
        <div className="stat-triple">
          <div className="st-cell"><div className="st-num">{s.conversations.inProgress}</div><div className="st-lbl">in progress</div></div>
          <div className="st-cell"><div className="st-num">{s.conversations.done}</div><div className="st-lbl">done</div></div>
          <div className="st-cell"><div className="st-num">{s.conversations.total}</div><div className="st-lbl">total</div></div>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-label">Share of use · today</div>
        <div className="share-list">
          {s.share.map((row) => {
            const e = EXPERT_BY_ID[row.id];
            return (
              <div className="share-row" key={row.id}>
                <span className="share-name">{e.name}</span>
                <span className="share-track">
                  <span className="share-fill" style={{ width: row.pct + "%", background: e.color }} />
                </span>
                <span className="share-pct">{row.pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="stats-foot">Local activity · stays on this device</div>
    </div>
  );
}

export function StudioHome({
  onOpenExpert,
  onOpenConv,
  onOpenProject,
  onNewRole
}: {
  onOpenExpert: (id: string) => void
  onOpenConv: (convId: string) => void
  onOpenProject: (id: string) => void
  onNewRole: () => void
}): ReactElement {
  const [tab, setTab] = useState("activity");
  return (
    <div className="main-col">
      <div className="conv-header">
        <span className="conv-title">Overview</span>
        <div className="studio-tabs segmented">
          <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button>
          <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Stats</button>
        </div>
        <span className="conv-sub" style={{ marginLeft: "auto" }}>
          {tab === "activity" ? "live work · right now" : "local analytics · today"}
        </span>
      </div>
      {tab === "activity" ? (
        <div className="studio-body">
          <ActivityTimeline onOpenExpert={onOpenExpert} onOpenConv={onOpenConv} onOpenProject={onOpenProject} />
          <StudioStats />
        </div>
      ) : (
        <StatsPage />
      )}
    </div>
  );
}
