/* ============================================================
   NicoSoft AI Studio — right workspace drawer (mock)
   Sections: Files · Recent images · Notes. Hairline, flat.
   ============================================================ */
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'

const WS_FILES = [
  { name: "design-brief.pdf", size: "1.2 MB", icon: "file" },
  { name: "data.csv", size: "84 KB", icon: "table" },
  { name: "scraper.log", size: "12 KB", icon: "terminal" },
];

const WS_NOTES = [
  { title: "OAuth fix", body: "Abort the in-flight token request on cleanup so two refreshes can't race." },
  { title: "Q2 launch", body: "Waitlist API + hero illustration done; funnel model still queued." },
];

/* small flat thumbnails standing in for Lyra's generated images */
function ImageThumb({ idx }: { idx: number }): ReactElement {
  const looks = [
    { bg: "#0a0a0f", a: "oklch(0.78 0.19 330)", b: "oklch(0.82 0.16 90)", t: "GAME" },
    { bg: "#0a0d0c", a: "oklch(0.72 0.16 195)", b: "oklch(0.75 0.10 158)", t: "ECO" },
    { bg: "#0d0a0c", a: "oklch(0.74 0.11 50)", b: "oklch(0.74 0.13 322)", t: "ARC" },
    { bg: "#090b0f", a: "oklch(0.70 0.12 255)", b: "oklch(0.76 0.10 205)", t: "SKY" },
  ];
  const l = looks[idx % looks.length];
  return (
    <div className="ws-thumb" style={{ background: l.bg }}>
      <span className="wt-bar" style={{ background: l.a }} />
      <span className="wt-label" style={{ color: l.a, fontFamily: "var(--mono)" }}>{l.t}</span>
      <span className="wt-bar sm" style={{ background: l.b }} />
    </div>
  );
}

export function WorkspaceDrawer({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="workspace-drawer">
      <div className="ws-header">
        <span className="ws-title">Workspace</span>
        <span className="ws-future">later</span>
        <button className="icon-btn" title="Collapse" onClick={onClose} style={{ marginLeft: "auto" }}>
          <Icons.panelRight size={16} />
        </button>
      </div>
      <div className="ws-scroll">
        <div className="ws-section">
          <div className="ws-section-head">Files</div>
          <div className="ws-files">
            {WS_FILES.map((f) => {
              const I = Icons[f.icon];
              return (
                <div className="ws-file" key={f.name}>
                  <span className="wf-ic"><I size={15} /></span>
                  <span className="wf-name">{f.name}</span>
                  <span className="wf-size">{f.size}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ws-section">
          <div className="ws-section-head">Recent images <span className="ws-by">· Lyra</span></div>
          <div className="ws-images">
            {[0, 1, 2, 3].map((i) => <ImageThumb key={i} idx={i} />)}
          </div>
        </div>

        <div className="ws-section">
          <div className="ws-section-head">Notes</div>
          <div className="ws-notes">
            {WS_NOTES.map((n) => (
              <div className="ws-note" key={n.title}>
                <div className="wn-title">{n.title}</div>
                <div className="wn-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
