"use client";

import { fmtDateTime, fmtPct, heat, signClass } from "@/lib/format";
import type { MarketData, Period } from "@/lib/types";
import { PERIODS } from "@/lib/types";

export function Chips<T extends string>({
  value, options, onChange, label, className = "",
}: {
  className?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={`chips ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={o.id === value}
          className={o.id === value ? "chip on" : "chip"}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodChips({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <Chips label="期間" value={value} onChange={onChange} options={PERIODS.map((p) => ({ id: p, label: p }))} />;
}

export function Pct({ v, digits = 1 }: { v: number | null | undefined; digits?: number }) {
  return <span className={`num ${signClass(v)}`}>{fmtPct(v, digits)}</span>;
}

export function HeatCell({ v, period, strong }: { v: number | null | undefined; period: Period; strong?: boolean }) {
  return (
    <td className={`num heat${strong ? " strong" : ""}`} style={{ background: heat(v, period) }}>
      {fmtPct(v)}
    </td>
  );
}

export function Star({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      className={on ? "star on" : "star"}
      aria-pressed={on}
      aria-label={on ? `${label}をお気に入りから外す` : `${label}をお気に入りに追加`}
      title={on ? "お気に入りから外す" : "お気に入りに追加"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

export function Sparkline({ values, width = 80, height = 24 }: { values: (number | null)[]; width?: number; height?: number }) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((x - min) / span) * (height - 4)).toFixed(1)}`);
  const up = v[v.length - 1] >= v[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" />
    </svg>
  );
}

/** データの基準日・更新時刻と、指数（S&P500など）の騰落率を表示する帯。 */
export function MarketBar({ data, period }: { data: MarketData; period: Period }) {
  return (
    <div className="marketbar">
      {data.benchmarks.map((b) => (
        <span key={b.symbol} className="bench">
          <span className="muted">{b.name}</span> <Pct v={b.returns[period]} digits={2} />
        </span>
      ))}
      <span className="muted small grow-right">
        基準日 {data.asOf}・更新 {fmtDateTime(data.updatedAt)}
      </span>
      {data.sample && <span className="badge warn">サンプルデータ</span>}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="loading">{error ? `⚠ ${error}` : "読み込み中…"}</div>;
}
