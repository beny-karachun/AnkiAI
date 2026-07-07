import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { CardRecord, ReviewLogRecord } from '../types';
import { CardState } from '../types';
import { dayStart, descendantIds } from '../lib/scheduler';

const DAY_MS = 24 * 60 * 60 * 1000;
const MATURE_DAYS = 21;

type Period = 30 | 90 | 365 | 0; // 0 = all

// Validated chart palette (dataviz six-checks, light+dark) — via CSS vars.
const RATING_VARS = ['--chart-again', '--chart-hard', '--chart-good', '--chart-easy'];
const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'];

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

function Tooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

/** Column with 4px rounded data-end, square baseline. */
function colPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function StatsView({ dayStartHour }: { dayStartHour: number }) {
  const [scopeDeck, setScopeDeck] = useState<string>('all');
  const [period, setPeriod] = useState<Period>(90);
  const [forecastDays, setForecastDays] = useState<30 | 90 | 365>(30);
  const [tip, setTip] = useState<TooltipState | null>(null);

  const data = useLiveQuery(async () => {
    const [cards, revlog, decks] = await Promise.all([
      db.cards.toArray(),
      db.revlog.toArray(),
      db.decks.toArray(),
    ]);
    return { cards, revlog, decks };
  }, []);

  const scoped = useMemo(() => {
    if (!data) return null;
    if (scopeDeck === 'all') return { cards: data.cards, revlog: data.revlog };
    const ids = new Set(descendantIds(data.decks, scopeDeck));
    return {
      cards: data.cards.filter((c) => ids.has(c.deckId)),
      revlog: data.revlog.filter((r) => ids.has(r.deckId)),
    };
  }, [data, scopeDeck]);

  if (!data || !scoped) return <div className="view-pad">Loading…</div>;

  const now = Date.now();
  const todayStartMs = dayStart(now, dayStartHour);
  const periodStart = period === 0 ? 0 : now - period * DAY_MS;
  const { cards, revlog } = scoped;
  const periodLog = revlog.filter((r) => r.review >= periodStart);

  return (
    <div className="view-pad stats-view anim-in" onMouseLeave={() => setTip(null)}>
      <div className="view-head">
        <h2>Statistics</h2>
        <div className="stats-controls">
          <select className="select" value={scopeDeck} onChange={(e) => setScopeDeck(e.target.value)} aria-label="Deck scope">
            <option value="all">All decks</option>
            {data.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="seg-control" role="group" aria-label="Period">
            {([30, 90, 365, 0] as Period[]).map((p) => (
              <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                {p === 0 ? 'All' : p === 365 ? '1y' : `${p / 30}m`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TodaySection revlog={revlog} todayStartMs={todayStartMs} dayStartHour={dayStartHour} />
      <ForecastChart
        cards={cards}
        todayStartMs={todayStartMs}
        days={forecastDays}
        onRange={setForecastDays}
        setTip={setTip}
      />
      <HeatmapChart revlog={revlog} dayStartHour={dayStartHour} setTip={setTip} />
      <AnswerButtonsChart revlog={periodLog} setTip={setTip} />
      <div className="stats-row-2">
        <CardCountsChart cards={cards} now={now} />
        <RetentionSection revlog={periodLog} />
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Today ----------

function TodaySection({
  revlog,
  todayStartMs,
  dayStartHour,
}: {
  revlog: ReviewLogRecord[];
  todayStartMs: number;
  dayStartHour: number;
}) {
  const today = revlog.filter((r) => r.review >= todayStartMs);
  const minutes = today.reduce((s, r) => s + r.durationMs, 0) / 60000;
  const again = today.filter((r) => r.rating === 1).length;
  const passRate = today.length ? Math.round((1 - again / today.length) * 100) : null;

  // streaks over study days
  const days = new Set(revlog.map((r) => Math.floor((r.review - dayStartHour * 3600_000) / DAY_MS)));
  const todayKey = Math.floor((Date.now() - dayStartHour * 3600_000) / DAY_MS);
  let streak = 0;
  for (let d = todayKey; days.has(d); d--) streak++;
  if (streak === 0 && days.has(todayKey - 1)) {
    for (let d = todayKey - 1; days.has(d); d--) streak++;
  }

  return (
    <section className="stats-section">
      <h3>Today</h3>
      <div className="stat-row">
        <StatTile label="Cards studied" value={String(today.length)} />
        <StatTile
          label="Time"
          value={`${minutes < 1 ? '<1' : Math.round(minutes)} min`}
          hint={today.length ? `${(minutes * 60 / today.length).toFixed(1)}s per card` : undefined}
        />
        <StatTile label="Pass rate" value={passRate == null ? '—' : `${passRate}%`} hint={today.length ? `${again} again` : 'no reviews yet'} />
        <StatTile label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} />
      </div>
    </section>
  );
}

// ---------- Future due forecast ----------

function ForecastChart({
  cards,
  todayStartMs,
  days,
  onRange,
  setTip,
}: {
  cards: CardRecord[];
  todayStartMs: number;
  days: 30 | 90 | 365;
  onRange: (d: 30 | 90 | 365) => void;
  setTip: (t: TooltipState | null) => void;
}) {
  const buckets = useMemo(() => {
    const young = new Array(days).fill(0);
    const mature = new Array(days).fill(0);
    let backlog = 0;
    for (const c of cards) {
      if (c.suspended || c.state === CardState.New) continue;
      const idx = Math.floor((c.due - todayStartMs) / DAY_MS);
      const isMature = c.scheduled_days >= MATURE_DAYS;
      if (idx < 0) {
        backlog++;
      } else if (idx < days) {
        if (isMature) mature[idx]++;
        else young[idx]++;
      }
    }
    return { young, mature, backlog };
  }, [cards, todayStartMs, days]);

  const total = buckets.young.reduce((a, b) => a + b, 0) + buckets.mature.reduce((a, b) => a + b, 0);
  const W = 720;
  const H = 180;
  const PAD = { l: 34, r: 8, t: 8, b: 22 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const maxV = Math.max(1, ...buckets.young.map((v, i) => v + buckets.mature[i]));
  const slot = iw / days;
  const barW = Math.min(24, Math.max(2, slot * 0.72));
  const yTicks = niceTicks(maxV);

  return (
    <section className="stats-section card-panel chart-card">
      <div className="chart-head">
        <div>
          <h3>Future due</h3>
          <span className="tooltip-hint">
            {total} review{total === 1 ? '' : 's'} in the next {days} days
            {buckets.backlog > 0 && ` · ${buckets.backlog} overdue (shown on today)`}
          </span>
        </div>
        <div className="chart-legend-and-range">
          <span className="legend">
            <span className="legend-item"><span className="swatch" style={{ background: 'var(--chart-young)' }} /> Young &lt;21d</span>
            <span className="legend-item"><span className="swatch" style={{ background: 'var(--chart-mature)' }} /> Mature</span>
          </span>
          <div className="seg-control" role="group" aria-label="Forecast range">
            {([30, 90, 365] as const).map((d) => (
              <button key={d} className={days === d ? 'active' : ''} onClick={() => onRange(d)}>
                {d === 365 ? '1y' : `${d}d`}
              </button>
            ))}
          </div>
        </div>
      </div>
      {total === 0 && buckets.backlog === 0 ? (
        <div className="chart-empty">Nothing scheduled yet — study some cards first.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`Future due forecast for ${days} days`}>
          {yTicks.map((t) => {
            const y = PAD.t + ih - (t / maxV) * ih;
            return (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="gridline" />
                <text x={PAD.l - 6} y={y + 3.5} className="axis-text" textAnchor="end">
                  {t}
                </text>
              </g>
            );
          })}
          {buckets.young.map((yv, i) => {
            const overdueExtra = i === 0 ? buckets.backlog : 0;
            const yTotal = yv + overdueExtra;
            const mv = buckets.mature[i];
            if (yTotal + mv === 0) return null;
            const x = PAD.l + i * slot + (slot - barW) / 2;
            const hY = (yTotal / maxV) * ih;
            const hM = (mv / maxV) * ih;
            const gap = hY > 0 && hM > 0 ? 2 : 0;
            const yM = PAD.t + ih - hM - gap - hY;
            const date = new Date(todayStartMs + i * DAY_MS);
            return (
              <g
                key={i}
                onMouseMove={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left + 12,
                    y: e.clientY - rect.top - 10,
                    lines: [
                      i === 0 ? 'Today' : date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
                      `${yTotal + mv} due — ${yTotal} young, ${mv} mature`,
                    ],
                  });
                }}
                onMouseLeave={() => setTip(null)}
              >
                <rect x={x - 2} y={PAD.t} width={barW + 4} height={ih} fill="transparent" />
                {hM > 0 && <path d={colPath(x, yM, barW, hM)} fill="var(--chart-mature)" />}
                {hY > 0 && <rect x={x} y={PAD.t + ih - hY} width={barW} height={hY} fill="var(--chart-young)" rx={hM > 0 ? 0 : undefined} ry={hM > 0 ? 0 : undefined} />}
                {hY > 0 && hM === 0 && <path d={colPath(x, PAD.t + ih - hY, barW, hY)} fill="var(--chart-young)" />}
              </g>
            );
          })}
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="axis-line" />
          {[0, Math.floor(days / 2), days - 1].map((i) => (
            <text key={i} x={PAD.l + i * slot + slot / 2} y={H - 6} className="axis-text" textAnchor="middle">
              {i === 0 ? 'today' : `+${i}d`}
            </text>
          ))}
        </svg>
      )}
    </section>
  );
}

function niceTicks(max: number): number[] {
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const step = Math.max(1, Math.ceil(rough / pow) * pow);
  const ticks: number[] = [];
  for (let v = step; v <= max; v += step) ticks.push(v);
  return ticks;
}

// ---------- Calendar heatmap ----------

function HeatmapChart({
  revlog,
  dayStartHour,
  setTip,
}: {
  revlog: ReviewLogRecord[];
  dayStartHour: number;
  setTip: (t: TooltipState | null) => void;
}) {
  const { weeks, monthLabels, maxCount, daysStudied, totalDays, longest } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of revlog) {
      const d = new Date(r.review - dayStartHour * 3600_000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 364 - end.getDay());
    const weeks: { date: Date; count: number }[][] = [];
    const monthLabels: { x: number; label: string }[] = [];
    let cur = new Date(start);
    let week: { date: Date; count: number }[] = [];
    let lastMonth = -1;
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
      week.push({ date: new Date(cur), count: counts.get(key) ?? 0 });
      if (cur.getDay() === 6 || cur.getTime() === end.getTime()) {
        weeks.push(week);
        if (week[0].date.getMonth() !== lastMonth) {
          lastMonth = week[0].date.getMonth();
          monthLabels.push({
            x: weeks.length - 1,
            label: week[0].date.toLocaleDateString([], { month: 'short' }),
          });
        }
        week = [];
      }
      cur.setDate(cur.getDate() + 1);
    }
    const nonzero = [...counts.values()];
    const maxCount = Math.max(1, ...nonzero);
    // streaks
    let longest = 0;
    let run = 0;
    const d = new Date(start);
    while (d <= end) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if ((counts.get(key) ?? 0) > 0) {
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
      d.setDate(d.getDate() + 1);
    }
    return {
      weeks,
      monthLabels,
      maxCount,
      daysStudied: nonzero.filter((c) => c > 0).length,
      totalDays: 365,
      longest,
    };
  }, [revlog, dayStartHour]);

  const CELL = 11;
  const GAP = 2;
  const W = weeks.length * (CELL + GAP) + 30;
  const H = 7 * (CELL + GAP) + 22;

  const bucket = (count: number): number => {
    if (count === 0) return 0;
    const f = count / maxCount;
    return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
  };

  return (
    <section className="stats-section card-panel chart-card">
      <div className="chart-head">
        <div>
          <h3>Review calendar</h3>
          <span className="tooltip-hint">
            {daysStudied} of {totalDays} days studied ({Math.round((daysStudied / totalDays) * 100)}%) · longest streak {longest} days
          </span>
        </div>
        <span className="legend heat-legend">
          Less
          {[0, 1, 2, 3, 4].map((b) => (
            <span key={b} className="heat-swatch" style={{ background: `var(--heat-${b})` }} />
          ))}
          More
        </span>
      </div>
      <div className="heatmap-scroll">
        <svg width={W} height={H} className="chart-svg heatmap-svg" role="img" aria-label="Daily review heatmap for the past year">
          {monthLabels.map((m, i) => (
            <text key={i} x={30 + m.x * (CELL + GAP)} y={10} className="axis-text">
              {m.label}
            </text>
          ))}
          {['Mon', 'Wed', 'Fri'].map((d, i) => (
            <text key={d} x={0} y={22 + (1 + i * 2) * (CELL + GAP) + CELL - 2} className="axis-text">
              {d}
            </text>
          ))}
          {weeks.map((week, wi) =>
            week.map((day) => (
              <rect
                key={day.date.toISOString()}
                x={30 + wi * (CELL + GAP)}
                y={14 + day.date.getDay() * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={`var(--heat-${bucket(day.count)})`}
                onMouseMove={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).closest('.heatmap-scroll')!.getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left + 12,
                    y: e.clientY - rect.top - 8,
                    lines: [
                      day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
                      `${day.count} review${day.count === 1 ? '' : 's'}`,
                    ],
                  });
                }}
                onMouseLeave={() => setTip(null)}
              />
            )),
          )}
        </svg>
      </div>
    </section>
  );
}

// ---------- Answer buttons ----------

function AnswerButtonsChart({
  revlog,
  setTip,
}: {
  revlog: ReviewLogRecord[];
  setTip: (t: TooltipState | null) => void;
}) {
  const groups = useMemo(() => {
    const mk = () => [0, 0, 0, 0];
    const g = { Learning: mk(), Young: mk(), Mature: mk() };
    for (const r of revlog) {
      const key =
        r.state === CardState.Learning || r.state === CardState.Relearning || r.state === CardState.New
          ? 'Learning'
          : r.scheduled_days < MATURE_DAYS
            ? 'Young'
            : 'Mature';
      g[key][r.rating - 1]++;
    }
    return g;
  }, [revlog]);

  const names = Object.keys(groups) as (keyof typeof groups)[];
  const maxV = Math.max(1, ...names.flatMap((n) => groups[n]));
  const W = 720;
  const H = 190;
  const PAD = { l: 34, r: 8, t: 8, b: 34 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const groupW = iw / names.length;
  const barW = Math.min(24, (groupW * 0.66) / 4);
  const total = names.flatMap((n) => groups[n]).reduce((a, b) => a + b, 0);

  return (
    <section className="stats-section card-panel chart-card">
      <div className="chart-head">
        <div>
          <h3>Answer buttons</h3>
          <span className="tooltip-hint">How you rated cards in the selected period</span>
        </div>
        <span className="legend">
          {RATING_LABELS.map((l, i) => (
            <span key={l} className="legend-item">
              <span className="swatch" style={{ background: `var(${RATING_VARS[i]})` }} /> {l}
            </span>
          ))}
        </span>
      </div>
      {total === 0 ? (
        <div className="chart-empty">No reviews in this period.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Answer button counts by card maturity">
          {niceTicks(maxV).map((t) => {
            const y = PAD.t + ih - (t / maxV) * ih;
            return (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="gridline" />
                <text x={PAD.l - 6} y={y + 3.5} className="axis-text" textAnchor="end">
                  {t}
                </text>
              </g>
            );
          })}
          {names.map((name, gi) => {
            const vals = groups[name];
            const gTotal = vals.reduce((a, b) => a + b, 0);
            const correct = gTotal ? Math.round(((gTotal - vals[0]) / gTotal) * 100) : 0;
            const x0 = PAD.l + gi * groupW + (groupW - 4 * barW - 3 * 2) / 2;
            return (
              <g key={name}>
                {vals.map((v, ri) => {
                  const h = (v / maxV) * ih;
                  const x = x0 + ri * (barW + 2);
                  return (
                    <g
                      key={ri}
                      onMouseMove={(e) => {
                        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setTip({
                          x: e.clientX - rect.left + 12,
                          y: e.clientY - rect.top - 10,
                          lines: [`${name} — ${RATING_LABELS[ri]}`, `${v} press${v === 1 ? '' : 'es'}`],
                        });
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      <rect x={x - 1} y={PAD.t} width={barW + 2} height={ih} fill="transparent" />
                      {h > 0 && <path d={colPath(x, PAD.t + ih - h, barW, h)} fill={`var(${RATING_VARS[ri]})`} />}
                    </g>
                  );
                })}
                <text x={PAD.l + gi * groupW + groupW / 2} y={H - 18} className="axis-text" textAnchor="middle">
                  {name}
                </text>
                <text x={PAD.l + gi * groupW + groupW / 2} y={H - 5} className="axis-text axis-strong" textAnchor="middle">
                  {gTotal ? `${correct}% correct` : '—'}
                </text>
              </g>
            );
          })}
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="axis-line" />
        </svg>
      )}
    </section>
  );
}

// ---------- Card counts ----------

function CardCountsChart({ cards, now }: { cards: CardRecord[]; now: number }) {
  const counts = useMemo(() => {
    const c = { New: 0, Learning: 0, Young: 0, Mature: 0, Suspended: 0, Buried: 0 };
    for (const card of cards) {
      if (card.suspended) c.Suspended++;
      else if (card.buriedUntil != null && card.buriedUntil > now) c.Buried++;
      else if (card.state === CardState.New) c.New++;
      else if (card.state === CardState.Learning || card.state === CardState.Relearning) c.Learning++;
      else if (card.scheduled_days < MATURE_DAYS) c.Young++;
      else c.Mature++;
    }
    return c;
  }, [cards, now]);

  const entries = Object.entries(counts);
  const total = cards.length;
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const COLORS: Record<string, string> = {
    New: 'var(--chart-easy)',
    Learning: 'var(--chart-again)',
    Young: 'var(--chart-young)',
    Mature: 'var(--chart-mature)',
    Suspended: 'var(--chart-hard)',
    Buried: 'var(--color-fg-faint)',
  };

  return (
    <section className="stats-section card-panel chart-card">
      <div className="chart-head">
        <div>
          <h3>Card counts</h3>
          <span className="tooltip-hint">{total} cards total</span>
        </div>
      </div>
      {total === 0 ? (
        <div className="chart-empty">No cards yet.</div>
      ) : (
        <div className="hbar-list">
          {entries.map(([name, v]) => (
            <div key={name} className="hbar-row">
              <span className="hbar-label">{name}</span>
              <span className="hbar-track">
                <span
                  className="hbar-fill"
                  style={{ width: `${(v / max) * 100}%`, background: COLORS[name] }}
                />
              </span>
              <span className="hbar-value">
                {v} <span className="hbar-pct">{total ? Math.round((v / total) * 100) : 0}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- True retention ----------

function RetentionSection({ revlog }: { revlog: ReviewLogRecord[] }) {
  const stats = useMemo(() => {
    const calc = (logs: ReviewLogRecord[]) => {
      const n = logs.length;
      if (!n) return null;
      const pass = logs.filter((r) => r.rating > 1).length;
      return { pct: Math.round((pass / n) * 100), pass, total: n };
    };
    const reviews = revlog.filter((r) => r.state === CardState.Review);
    return {
      young: calc(reviews.filter((r) => r.scheduled_days < MATURE_DAYS)),
      mature: calc(reviews.filter((r) => r.scheduled_days >= MATURE_DAYS)),
      all: calc(reviews),
      aiGraded: revlog.filter((r) => r.ai).length,
      aiAvg:
        revlog.filter((r) => r.ai).length > 0
          ? Math.round(
              revlog.filter((r) => r.ai).reduce((s, r) => s + (r.ai?.score ?? 0), 0) /
                revlog.filter((r) => r.ai).length,
            )
          : null,
    };
  }, [revlog]);

  const fmt = (s: { pct: number; pass: number; total: number } | null) =>
    s ? `${s.pct}%` : '—';
  const hint = (s: { pct: number; pass: number; total: number } | null) =>
    s ? `${s.pass}/${s.total} passed` : 'no reviews';

  return (
    <section className="stats-section card-panel chart-card">
      <div className="chart-head">
        <div>
          <h3>True retention</h3>
          <span className="tooltip-hint">Pass rate on review cards (non-Again answers)</span>
        </div>
      </div>
      <div className="stat-row retention-row">
        <StatTile label="Young" value={fmt(stats.young)} hint={hint(stats.young)} />
        <StatTile label="Mature" value={fmt(stats.mature)} hint={hint(stats.mature)} />
        <StatTile label="Overall" value={fmt(stats.all)} hint={hint(stats.all)} />
        <StatTile
          label="AI-graded reviews"
          value={String(stats.aiGraded)}
          hint={stats.aiAvg != null ? `avg understanding ${stats.aiAvg}/100` : 'none yet'}
        />
      </div>
    </section>
  );
}
