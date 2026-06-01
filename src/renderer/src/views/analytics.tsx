/* ============================================================
   NicoSoft AI Studio — Studio › Stats (local-only analytics)
   Restrained charts: thin lines, low-sat bars, hairline gridlines.
   No gradients / 3D / glow. No cost-billing. No reliability panel.
   ============================================================ */
import type { ReactElement, ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { Avatar } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'

const FAMILY_COLOR: Record<string, string> = {
  anthropic: "oklch(0.76 0.10 50)",
  openai: "oklch(0.75 0.10 158)",
  gemini: "oklch(0.74 0.10 250)",
};

type TrendPoint = number | { v: number }

/* — Thin line trend with hairline gridlines (non-scaling strokes) — */
export function LineTrend({
  data,
  color = "var(--accent)",
  height = 60,
  labels
}: {
  data: TrendPoint[]
  color?: string
  height?: number
  labels?: string[]
}): ReactElement {
  const values = data.map((d) => (typeof d === "number" ? d : d.v));
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, 30 - (v / max) * 25 - 2]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `0,30 ${line} 100,30`;
  return (
    <div>
      <svg className="line-trend" viewBox="0 0 100 32" preserveAspectRatio="none" style={{ height }}>
        {[8, 16, 24].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} className="grid-line" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={area} fill={color} fillOpacity="0.07" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {labels && (
        <div className="trend-labels">
          {labels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

interface BarRow {
  name: string
  v: number
  val: string
  color?: string
}

/* — Horizontal bar list — */
export function BarList({ rows, max, neutral }: { rows: BarRow[]; max?: number; neutral?: boolean }): ReactElement {
  const m = max || Math.max(...rows.map((r) => r.v), 1);
  return (
    <div className="bar-list">
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-name" title={r.name}>{r.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: (r.v / m) * 100 + "%", background: neutral ? "var(--text-3)" : r.color }} />
          </span>
          <span className="bar-val">{r.val}</span>
        </div>
      ))}
    </div>
  );
}

/* — Vertical mini bars (peak hours) — */
export function MiniBars({ data, peakColor = "var(--accent)" }: { data: number[]; peakColor?: string }): ReactElement {
  const max = Math.max(...data, 1);
  return (
    <div className="mini-bars">
      {data.map((v, i) => (
        <span key={i} className="mini-bar"
          style={{ height: Math.max(2, (v / max) * 100) + "%", background: v === max ? peakColor : "var(--text-4)" }} />
      ))}
    </div>
  );
}

function AnCard({ title, sub, children, wide }: { title: string; sub?: string; children: ReactNode; wide?: boolean }): ReactElement {
  return (
    <div className={"an-card" + (wide ? " wide" : "")}>
      <div className="an-card-head">
        <span className="an-card-title">{title}</span>
        {sub && <span className="an-card-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function StatsPage(): ReactElement {
  const { STUDIO, EXPERT_BY_ID } = STUDIO_DATA;
  const A = STUDIO.analytics;

  const expertRows = A.usage.byExpert.map((r) => {
    const e = EXPERT_BY_ID[r.id!];
    return { name: e.name, v: r.v, val: r.v + "K", color: e.color };
  });
  const modelRows = A.usage.byModel.map((r) => ({ name: r.label!, v: r.v, val: r.v + "K", color: FAMILY_COLOR[r.family!] }));
  const providerRows = A.usage.byProvider.map((r) => ({ name: r.label!, v: r.v, val: r.v + "K", color: FAMILY_COLOR[r.family!] }));
  const memRows = A.memory.perExpert.map((r) => {
    const e = EXPERT_BY_ID[r.id!];
    return { name: e.name, v: r.v, val: String(r.v), color: e.color };
  });
  const mostActive = EXPERT_BY_ID[A.activity.mostActive.id];
  const layerMax = A.memory.layers.reduce((s, l) => s + l.v, 0);

  return (
    <div className="studio-analytics">
      {/* ——— USAGE ——— */}
      <div className="an-section">
        <div className="an-section-head">Usage</div>
        <div className="an-grid">
          <AnCard title="Tokens">
            <div className="token-totals">
              <div className="tt-cell">
                <div className="tt-num">{A.usage.tokensTotal}</div>
                <div className="tt-lbl">today</div>
              </div>
              <div className="tt-cell">
                <div className="tt-num">{A.usage.tokensAllTime}</div>
                <div className="tt-lbl">all-time</div>
              </div>
            </div>
            <div className="an-mini-label" style={{ marginTop: 14 }}>Today · in / out</div>
            <div className="io-split">
              <div className="io-row">
                <span className="io-label">In</span>
                <span className="io-track"><span className="io-fill in" style={{ width: "66%" }} /></span>
                <span className="io-val">{A.usage.tokensIn}</span>
              </div>
              <div className="io-row">
                <span className="io-label">Out</span>
                <span className="io-track"><span className="io-fill out" style={{ width: "34%" }} /></span>
                <span className="io-val">{A.usage.tokensOut}</span>
              </div>
            </div>
            <div className="an-divider" />
            <div className="an-mini-label">Tokens · last 7 days</div>
            <LineTrend data={A.usage.byDay} labels={A.usage.byDay.map((d) => d.d)} />
          </AnCard>

          <AnCard title="Conversations">
            <div className="stat-triple">
              <div className="st-cell"><div className="st-num">{A.usage.conversations.inProgress}</div><div className="st-lbl">in progress</div></div>
              <div className="st-cell"><div className="st-num">{A.usage.conversations.done}</div><div className="st-lbl">done</div></div>
              <div className="st-cell"><div className="st-num">{A.usage.conversations.total}</div><div className="st-lbl">total</div></div>
            </div>
            <div className="an-divider" />
            <div className="an-mini-label">By provider</div>
            <BarList rows={providerRows} />
          </AnCard>

          <AnCard title="By expert">
            <BarList rows={expertRows} />
          </AnCard>

          <AnCard title="By model">
            <BarList rows={modelRows} />
          </AnCard>
        </div>
      </div>

      {/* ——— MEMORY & GROWTH ——— */}
      <div className="an-section">
        <div className="an-section-head">Memory &amp; growth <span className="an-section-note">— how well the team knows you</span></div>
        <div className="an-grid">
          <AnCard title="Memory by expert" sub={A.memory.total + " total"}>
            <BarList rows={memRows} />
          </AnCard>

          <AnCard title="Memory layers">
            <div className="stacked-bar">
              {A.memory.layers.map((l) => (
                <span key={l.key} className={"stk-seg " + l.key.toLowerCase()} style={{ width: (l.v / layerMax) * 100 + "%" }} />
              ))}
            </div>
            <div className="layer-legend">
              {A.memory.layers.map((l) => (
                <div className="ll-row" key={l.key}>
                  <span className={"ll-dot " + l.key.toLowerCase()} />
                  <span className="ll-key">{l.key}</span>
                  <span className="ll-hint">{l.hint}</span>
                  <span className="ll-val">{l.v}</span>
                </div>
              ))}
            </div>
          </AnCard>

          <AnCard title="Self-learning" sub="getting to know you">
            <div className="learn-stats">
              <div className="learn-cell">
                <div className="learn-num">{A.memory.learning.approved}</div>
                <div className="learn-lbl">approved</div>
              </div>
              <div className="learn-cell">
                <div className="learn-num">{A.memory.learning.corrected}</div>
                <div className="learn-lbl">corrected</div>
              </div>
            </div>
            <div className="an-divider" />
            <div className="an-mini-label">Learning events · last 4 weeks</div>
            <LineTrend data={A.memory.learning.byWeek} color="var(--exp-editor)" height={52}
              labels={["W1", "W2", "W3", "W4"]} />
          </AnCard>
        </div>
      </div>

      {/* ——— ACTIVITY ——— */}
      <div className="an-section">
        <div className="an-section-head">Activity</div>
        <div className="an-grid">
          <AnCard title="Activity trend" sub="last 14 days" wide>
            <LineTrend data={A.activity.byDay} color="var(--exp-engineer)" height={68} />
          </AnCard>

          <AnCard title="Most active">
            <div className="most-active">
              <Avatar expert={mostActive} size={34} />
              <div>
                <div className="ma-name">{mostActive.name}</div>
                <div className="ma-sub">{A.activity.mostActive.today} today · {A.activity.mostActive.week} this week</div>
              </div>
            </div>
            <div className="an-divider" />
            <div className="an-mini-label">Tool calls · today</div>
            <div className="tool-list">
              {A.activity.tools.map((t) => {
                const I = Icons[t.icon];
                return (
                  <div className="tool-row" key={t.label}>
                    <span className="tool-ic"><I size={14} /></span>
                    <span className="tool-lbl">{t.label}</span>
                    <span className="tool-val">{t.v}</span>
                  </div>
                );
              })}
            </div>
          </AnCard>

          <AnCard title="Peak hours" sub="by hour · today">
            <MiniBars data={A.activity.peakHours} />
            <div className="hour-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          </AnCard>
        </div>
      </div>

      <div className="an-foot">Local analytics · stays on this device · no usage leaves the app</div>
    </div>
  );
}
