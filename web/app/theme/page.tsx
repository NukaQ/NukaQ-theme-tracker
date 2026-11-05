"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import StockTable from "@/components/StockTable";
import { Loading, PeriodChips, Pct, Star } from "@/components/ui";
import { useMarketData } from "@/lib/data";
import { useFavorites } from "@/lib/favorites";
import { fmtCap, fmtPct } from "@/lib/format";
import { useViewParams, withView } from "@/lib/params";
import { LEVELS, PERIOD_DAYS, PERIODS, type Group, type MarketData, type Period } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ThemeDetail />
    </Suspense>
  );
}

function ThemeDetail() {
  const { market, period, sp, set } = useViewParams({ period: "1M" });
  const id = sp.get("id") ?? "";
  const { data, error } = useMarketData(market);
  const { fav, toggle } = useFavorites();

  if (!data) return <Loading error={error} />;
  const g = data.groups.find((x) => x.id === id);
  if (!g) {
    return (
      <div className="empty">
        テーマが見つかりません。<Link href={withView("/", market)} style={{ color: "var(--accent)" }}>ランキングに戻る</Link>
      </div>
    );
  }
  const ancestors = g.path.slice(0, -1).map((_, i) => data.groups.find((x) => x.path.join("/") === g.path.slice(0, i + 1).join("/")));
  const children = data.groups.filter((x) => x.parent === g.id);
  const peers = data.groups.filter((x) => x.level === g.level);
  const rank = [...peers].sort((a, b) => (b.returns[period] ?? -1e9) - (a.returns[period] ?? -1e9)).findIndex((x) => x.id === g.id) + 1;
  const favKey = `${market}:${g.id}`;
  const levelLabel = LEVELS.find((l) => l.id === g.level)?.label;

  return (
    <>
      <div className="crumbs">
        <Link href={withView("/", market, { lv: g.level })}>{data.name}</Link>
        {ancestors.map((a) => a && (
          <span key={a.id}> › <Link href={withView("/theme/", market, { id: a.id, p: period })}>{a.name}</Link></span>
        ))}
      </div>
      <div className="detail-head">
        <h1>{g.name}</h1>
        <Star on={fav.groups.includes(favKey)} onClick={() => toggle("groups", favKey)} label={g.name} />
        <span className="badge">{levelLabel}</span>
        <span className="muted small">{period}順位 {rank} / {peers.length}・{g.tickers.length}銘柄・{fmtCap(g.marketCap, data.currency)}</span>
      </div>

      <div className="stats">
        {PERIODS.map((p) => (
          <button key={p} className="stat" onClick={() => set({ p })}
            style={{ textAlign: "left", outline: p === period ? "2px solid var(--accent)" : undefined }}>
            <div className="k">{p}</div>
            <div className="v"><Pct v={g.returns[p]} /></div>
          </button>
        ))}
      </div>

      <div className="toolbar"><PeriodChips value={period} onChange={(p) => set({ p })} /></div>
      <div className="panel chart">
        <LineChart data={data} group={g} period={period} />
      </div>

      {children.length > 0 && (
        <>
          <h2>内訳</h2>
          <div className="children">
            {[...children].sort((a, b) => (b.returns[period] ?? -1e9) - (a.returns[period] ?? -1e9)).map((c) => (
              <Link key={c.id} href={withView("/theme/", market, { id: c.id, p: period })} className="child-card panel">
                <span>{c.name}</span>
                <Pct v={c.returns[period]} />
              </Link>
            ))}
          </div>
        </>
      )}

      <h2>構成銘柄</h2>
      <p className="muted small" style={{ marginTop: -4 }}>
        テーマの騰落率は、構成銘柄の騰落率を単純平均したものです（時価総額で重み付けしていません）。
      </p>
      <StockTable period={period}
        rows={g.tickers.map((t) => ({ market, ticker: t, stock: data.stocks[t], currency: data.currency }))} />
    </>
  );
}

const COLORS = ["var(--accent)", "#9aa3b2", "#c39bd3"];

/** テーマの値動きを指数と比べる折れ線グラフ（期間の初日を0%とする）。 */
function LineChart({ data, group, period }: { data: MarketData; group: Group; period: Period }) {
  const days = Math.max(PERIOD_DAYS[period], 21); // 1D・5Dでも1か月分は見せる
  const lines = useMemo(() => {
    const rebase = (s: (number | null)[]) => {
      const tail = s.slice(-(days + 1));
      const base = tail.find((x) => x !== null) ?? 100;
      return tail.map((x) => (x === null ? null : (x / base - 1) * 100));
    };
    return [
      { name: group.name, values: rebase(group.series) },
      ...data.benchmarks.map((b) => ({ name: b.name, values: rebase(b.series) })),
    ];
  }, [data, group, days]);
  const dates = data.dates.slice(-(days + 1));

  const W = 800, H = 280, L = 44, R = 12, T = 10, B = 24;
  const all = lines.flatMap((l) => l.values).filter((x): x is number => x !== null);
  if (all.length < 2) return <div className="empty">グラフを描くデータがありません</div>;
  let min = Math.min(0, ...all), max = Math.max(0, ...all);
  const pad = (max - min) * 0.08 || 1;
  min -= pad; max += pad;
  const n = Math.max(...lines.map((l) => l.values.length));
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const step = niceStep((max - min) / 5);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  const xticks = [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <>
      <div className="chart-legend">
        {lines.map((l, i) => (
          <span key={l.name}><i style={{ background: COLORS[i] }} />{l.name} <Pct v={l.values.at(-1) ?? null} /></span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${group.name}の値動き`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v === 0 ? "" : "3 3"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtPct(v, 0)}</text>
          </g>
        ))}
        {xticks.map((i) => dates[i] && (
          <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="var(--muted)"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{dates[i].slice(5).replace("-", "/")}</text>
        ))}
        {[...lines].reverse().map((l, ri) => {
          const i = lines.length - 1 - ri;
          const pts = l.values.map((v, j) => (v === null ? null : `${x(j).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
          return <polyline key={l.name} points={pts.join(" ")} fill="none" stroke={COLORS[i]} strokeWidth={i === 0 ? 2.2 : 1.4} />;
        })}
      </svg>
    </>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
